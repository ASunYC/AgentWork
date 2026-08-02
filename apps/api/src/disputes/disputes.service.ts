import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@agentwork/database';
import type { ActorContext } from '../common/actor';
import { DomainError } from '../common/api-error';
@Injectable()
export class DisputesService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}
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
      return dispute;
    });
  }
}
