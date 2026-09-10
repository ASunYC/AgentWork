import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@agentwork/database';
import type { ActorContext } from '../common/actor';
import { DomainError } from '../common/api-error';

@Injectable()
export class ReputationService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  async createReview(
    actor: ActorContext,
    taskId: string,
    input: {
      rating: number;
      dimensions: Record<string, number>;
      comment?: string;
    },
  ) {
    if (actor.type !== 'USER')
      throw new DomainError('FORBIDDEN', 'Only publishers can review', 403);
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: {
        assignments: { where: { releasedAt: null }, include: { agent: true } },
      },
    });
    if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
    if (task.publisherId !== actor.id)
      throw new DomainError('FORBIDDEN', 'Only the publisher can review', 403);
    if (!['COMPLETED_SETTLED', 'PARTIALLY_SETTLED'].includes(task.status))
      throw new DomainError('INVALID_STATE', 'Task is not settled');
    const assignment = task.assignments[0];
    if (!assignment)
      throw new DomainError('INVALID_STATE', 'Task has no Agent');
    if (assignment.agent.ownerUserId === actor.id)
      throw new DomainError(
        'SELF_REVIEW',
        'Self-associated tasks cannot be reviewed',
      );
    try {
      return await this.db.review.create({
        data: {
          taskId,
          reviewerId: actor.id,
          agentId: assignment.agentId,
          ...input,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new DomainError('ALREADY_REVIEWED', 'Task already reviewed');
      throw error;
    }
  }

  async agent(slug: string) {
    const agent = await this.db.agent.findUnique({
      where: { slug },
      select: { id: true, ownerUserId: true },
    });
    if (!agent) throw new DomainError('NOT_FOUND', 'Agent not found', 404);
    const [reviews, completed, disputed] = await Promise.all([
      this.db.review.findMany({
        where: {
          agentId: agent.id,
          status: 'PUBLISHED',
          ...(agent.ownerUserId
            ? { reviewerId: { not: agent.ownerUserId } }
            : {}),
        },
        select: { rating: true, dimensions: true },
      }),
      this.db.taskAssignment.count({
        where: {
          agentId: agent.id,
          task: { status: { in: ['COMPLETED_SETTLED', 'PARTIALLY_SETTLED'] } },
        },
      }),
      this.db.taskAssignment.count({
        where: { agentId: agent.id, task: { disputes: { some: {} } } },
      }),
    ]);
    const dimensionTotals = new Map<string, { total: number; count: number }>();
    for (const review of reviews)
      for (const [key, raw] of Object.entries(
        review.dimensions as Record<string, unknown>,
      )) {
        if (typeof raw !== 'number') continue;
        const value = dimensionTotals.get(key) ?? { total: 0, count: 0 };
        value.total += raw;
        value.count++;
        dimensionTotals.set(key, value);
      }
    return {
      agentId: agent.id,
      reviewCount: reviews.length,
      averageRating: reviews.length
        ? reviews.reduce((sum, review) => sum + review.rating, 0) /
          reviews.length
        : null,
      dimensions: Object.fromEntries(
        [...dimensionTotals].map(([key, value]) => [
          key,
          value.total / value.count,
        ]),
      ),
      completedTasks: completed,
      disputedTasks: disputed,
      disputeRate: completed + disputed ? disputed / (completed + disputed) : 0,
    };
  }

  async user(id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new DomainError('NOT_FOUND', 'User not found', 404);
    const grouped = await this.db.task.groupBy({
      by: ['status'],
      where: { publisherId: id },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      grouped.map((row) => [row.status, row._count._all]),
    );
    const total = grouped.reduce((sum, row) => sum + row._count._all, 0);
    return {
      userId: id,
      publishedTasks: total,
      completedTasks:
        (counts.COMPLETED_SETTLED ?? 0) + (counts.PARTIALLY_SETTLED ?? 0),
      disputedTasks: counts.DISPUTED ?? 0,
      cancelledTasks:
        (counts.CANCELLED_REFUNDED ?? 0) + (counts.EXPIRED_REFUNDED ?? 0),
    };
  }
}
