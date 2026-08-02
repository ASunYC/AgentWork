import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@agentwork/database';
import type { ActorContext } from '../common/actor';
import { DomainError } from '../common/api-error';
import { LEDGER_PORT, type LedgerPort } from '../ledger/ledger.port';

@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
  ) {}
  private async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  }
  private async base(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    id: string,
  ) {
    const task = await tx.task.findUnique({ where: { id } });
    if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
    return task;
  }
  async deliver(
    actor: ActorContext,
    id: string,
    input: {
      summary: string;
      content?: unknown;
      attachments: {
        objectKey: string;
        mimeType: string;
        size: bigint;
        checksum: string;
      }[];
      version: number;
    },
  ) {
    if (actor.type !== 'AGENT')
      throw new DomainError('FORBIDDEN', 'Agent required', 403);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const task = await this.base(tx, actor, id);
      const assigned = await tx.taskAssignment.findFirst({
        where: { taskId: id, agentId: actor.id, releasedAt: null },
      });
      if (!assigned)
        throw new DomainError('FORBIDDEN', 'Agent is not assigned', 403);
      if (!['IN_PROGRESS', 'REVISION_REQUESTED'].includes(task.status))
        throw new DomainError('INVALID_STATE', 'Delivery not allowed');
      const count = await tx.delivery.count({ where: { taskId: id } });
      if (count > task.maxRevisions)
        throw new DomainError('REVISION_LIMIT', 'Revision limit reached');
      const r = await tx.task.updateMany({
        where: { id, version: input.version, status: task.status },
        data: { status: 'DELIVERED', version: { increment: 1 } },
      });
      if (!r.count)
        throw new DomainError(
          'VERSION_CONFLICT',
          'Task state or version changed',
        );
      const delivery = await tx.delivery.create({
        data: {
          taskId: id,
          agentId: actor.id,
          version: count + 1,
          summary: input.summary,
          content: input.content as Prisma.InputJsonValue | undefined,
        },
      });
      if (input.attachments.length)
        await tx.attachment.createMany({
          data: input.attachments.map((a) => ({
            ...a,
            ownerType: 'DELIVERY',
            ownerId: delivery.id,
          })),
        });
      await tx.taskEvent.create({
        data: {
          taskId: id,
          actorType: 'AGENT',
          actorId: actor.id,
          type: 'task.delivered',
          payload: {
            deliveryId: delivery.id,
            deliveryVersion: delivery.version,
          },
        },
      });
      return delivery;
    });
  }
  async revision(
    actor: ActorContext,
    id: string,
    input: { reason: string; version: number },
  ) {
    if (actor.type !== 'USER')
      throw new DomainError('FORBIDDEN', 'Publisher required', 403);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const task = await this.base(tx, actor, id);
      if (task.publisherId !== actor.id)
        throw new DomainError('FORBIDDEN', 'Not task publisher', 403);
      if (task.status !== 'DELIVERED')
        throw new DomainError('INVALID_STATE', 'Revision not allowed');
      const deliveries = await tx.delivery.count({ where: { taskId: id } });
      if (deliveries - 1 >= task.maxRevisions)
        throw new DomainError('REVISION_LIMIT', 'Revision limit reached');
      const r = await tx.task.updateMany({
        where: { id, version: input.version, status: 'DELIVERED' },
        data: { status: 'REVISION_REQUESTED', version: { increment: 1 } },
      });
      if (!r.count)
        throw new DomainError(
          'VERSION_CONFLICT',
          'Task state or version changed',
        );
      await tx.taskEvent.create({
        data: {
          taskId: id,
          actorType: 'USER',
          actorId: actor.id,
          type: 'task.revision_requested',
          payload: { reason: input.reason, revision: deliveries },
        },
      });
      return tx.task.findUniqueOrThrow({ where: { id } });
    });
  }
  async accept(
    actor: ActorContext,
    id: string,
    { version }: { version: number },
  ) {
    if (actor.type !== 'USER')
      throw new DomainError('FORBIDDEN', 'Publisher required', 403);
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, id);
        const task = await this.base(tx, actor, id);
        if (task.publisherId !== actor.id)
          throw new DomainError('FORBIDDEN', 'Not task publisher', 403);
        if (task.status === 'COMPLETED_SETTLED') return task;
        if (task.status !== 'DELIVERED')
          throw new DomainError('INVALID_STATE', 'Acceptance not allowed');
        const assignment = await tx.taskAssignment.findFirst({
          where: { taskId: id, releasedAt: null },
        });
        if (!assignment)
          throw new DomainError('NO_ASSIGNMENT', 'No active assignment');
        await this.ledger.settle({
          taskId: id,
          publisherId: actor.id,
          agentId: assignment.agentId,
          amount: task.budget,
          idempotencyKey: `task:${id}:settle`,
          transaction: tx,
        });
        const r = await tx.task.updateMany({
          where: { id, version, status: 'DELIVERED' },
          data: { status: 'COMPLETED_SETTLED', version: { increment: 1 } },
        });
        if (!r.count)
          throw new DomainError(
            'VERSION_CONFLICT',
            'Task state or version changed',
          );
        await tx.taskEvent.create({
          data: {
            taskId: id,
            actorType: 'USER',
            actorId: actor.id,
            type: 'task.accepted',
            payload: { amount: task.budget.toString() },
          },
        });
        return tx.task.findUniqueOrThrow({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
