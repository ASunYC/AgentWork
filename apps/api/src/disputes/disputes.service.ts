import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@agentwork/database';
import type { ActorContext } from '../common/actor';
import { DomainError } from '../common/api-error';
import { LedgerService } from '../ledger/ledger.service';
import { DomainEventPublisherPort } from '../webhooks/domain-event.publisher';
@Injectable()
export class DisputesService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly domainEvents: DomainEventPublisherPort,
  ) {}
  async open(
    actor: ActorContext,
    id: string,
    input: { reason: string; version: number },
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const task = await tx.task.findUnique({
        where: { id },
        include: { assignments: { where: { releasedAt: null } } },
      });
      if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
      const authorized =
        actor.type === 'USER'
          ? task.publisherId === actor.id
          : task.assignments.some((a) => a.agentId === actor.id);
      if (!authorized)
        throw new DomainError('FORBIDDEN', 'Not a task party', 403);
      if (
        ![
          'ASSIGNED',
          'IN_PROGRESS',
          'DELIVERED',
          'REVISION_REQUESTED',
        ].includes(task.status)
      )
        throw new DomainError('INVALID_STATE', 'Dispute not allowed');
      const r = await tx.task.updateMany({
        where: { id, version: input.version, status: task.status },
        data: { status: 'DISPUTED', version: { increment: 1 } },
      });
      if (!r.count)
        throw new DomainError(
          'VERSION_CONFLICT',
          'Task state or version changed',
        );
      const dispute = await tx.dispute.create({
        data: {
          taskId: id,
          openedByType: actor.type,
          openedById: actor.id,
          reason: input.reason,
        },
      });
      await tx.taskEvent.create({
        data: {
          taskId: id,
          actorType: actor.type,
          actorId: actor.id,
          type: 'task.disputed',
          payload: { disputeId: dispute.id },
        },
      });
      await this.domainEvents.publish(
        'dispute.opened',
        id,
        {
          task_id: id,
          dispute_id: dispute.id,
          opened_by_type: actor.type,
          opened_by_id: actor.id,
          reason: input.reason,
        },
        tx,
        `dispute:${dispute.id}:opened`,
      );
      return dispute;
    });
  }

  async addEvidence(
    actor: ActorContext,
    disputeId: string,
    input: {
      objectKey: string;
      mimeType: string;
      size: bigint;
      checksum: string;
    },
  ) {
    const dispute = await this.db.dispute.findUnique({
      where: { id: disputeId },
      include: {
        task: { include: { assignments: { where: { releasedAt: null } } } },
      },
    });
    if (!dispute) throw new DomainError('NOT_FOUND', 'Dispute not found', 404);
    const authorized =
      actor.type === 'USER'
        ? dispute.task.publisherId === actor.id
        : dispute.task.assignments.some((a) => a.agentId === actor.id);
    if (!authorized)
      throw new DomainError('FORBIDDEN', 'Not a task party', 403);
    if (!['OPEN', 'INVESTIGATING'].includes(dispute.status))
      throw new DomainError(
        'INVALID_STATE',
        'Dispute no longer accepts evidence',
      );
    return this.db.attachment.create({
      data: { ownerType: 'DISPUTE', ownerId: disputeId, ...input },
    });
  }

  async resolve(
    adminId: string,
    requestId: string,
    disputeId: string,
    input: {
      refundAmount: bigint;
      payoutAmount: bigint;
      note: string;
      idempotencyKey: string;
    },
  ) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${disputeId}))`;
        const dispute = await tx.dispute.findUnique({
          where: { id: disputeId },
          include: {
            task: { include: { assignments: { where: { releasedAt: null } } } },
          },
        });
        if (!dispute)
          throw new DomainError('NOT_FOUND', 'Dispute not found', 404);
        if (dispute.status === 'RESOLVED') return dispute;
        if (dispute.task.status !== 'DISPUTED')
          throw new DomainError('INVALID_STATE', 'Task is not disputed');
        const assignment = dispute.task.assignments[0];
        if (!assignment)
          throw new DomainError(
            'INVALID_STATE',
            'Task has no active assignment',
          );
        if (input.refundAmount + input.payoutAmount !== dispute.task.budget)
          throw new DomainError(
            'INVALID_SPLIT',
            'Refund and payout must equal task budget',
          );
        const ledger = await this.ledger.resolveDispute(
          dispute.taskId,
          dispute.task.publisherId,
          assignment.agentId,
          input.refundAmount,
          input.payoutAmount,
          { idempotencyKey: input.idempotencyKey },
          tx,
        );
        const taskStatus =
          input.refundAmount === 0n
            ? 'COMPLETED_SETTLED'
            : input.payoutAmount === 0n
              ? 'CANCELLED_REFUNDED'
              : 'PARTIALLY_SETTLED';
        const resolution = {
          refundAmount: input.refundAmount.toString(),
          payoutAmount: input.payoutAmount.toString(),
          note: input.note,
          ledgerTransactionId: ledger.transactionId,
        };
        const updated = await tx.dispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED',
            resolution,
            resolvedBy: adminId,
            resolvedAt: new Date(),
          },
        });
        await tx.task.update({
          where: { id: dispute.taskId },
          data: { status: taskStatus, version: { increment: 1 } },
        });
        await tx.taskEvent.create({
          data: {
            taskId: dispute.taskId,
            actorType: 'ADMIN',
            actorId: adminId,
            type: 'dispute.resolved',
            payload: resolution,
          },
        });
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId: adminId,
            action: 'dispute.resolve',
            resourceType: 'dispute',
            resourceId: disputeId,
            before: { status: dispute.status },
            after: resolution,
            requestId,
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
