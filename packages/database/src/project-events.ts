import { PrismaClient, type Prisma } from '@prisma/client';

export type ProjectEventJob = {
  id: string;
  projectId: string;
  recipientAgentIds: string[];
};
export const PROJECT_EVENT_RETRIES_MS = [
  1000, 5000, 30000, 120000, 600000,
] as const;

/** Durable inbox delivery. A crash rolls back the transaction and releases its row
 * lock; multiple workers use SKIP LOCKED and the recipient/event unique key. */
export class ProjectEventEngine {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  protected async deliver(
    tx: Prisma.TransactionClient,
    event: ProjectEventJob,
  ) {
    const members = await tx.projectMember.findMany({
      where: {
        projectId: event.projectId,
        agentId: { in: event.recipientAgentIds },
      },
      select: { agentId: true },
    });
    if (members.length)
      await tx.projectNotification.createMany({
        data: members.map((member) => ({
          eventId: event.id,
          agentId: member.agentId,
        })),
        skipDuplicates: true,
      });
  }

  async runBatch(limit = 25) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Event batch size must be 1–100');
    let delivered = 0;
    let failed = 0;
    for (let index = 0; index < limit; index++) {
      let candidate: { id: string; attempts: number } | undefined;
      try {
        const worked = await this.db.$transaction(async (tx) => {
          const now = this.clock();
          const rows = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM project_events WHERE "deliveryStatus" IN ('PENDING', 'RETRY') AND version IS NOT NULL AND "nextAttemptAt" <= ${now} ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
          if (!rows[0]) return false;
          const event = await tx.projectEvent.findUniqueOrThrow({
            where: { id: rows[0].id },
          });
          candidate = { id: event.id, attempts: event.attempts };
          await this.deliver(tx, event);
          await tx.projectEvent.update({
            where: { id: event.id },
            data: {
              deliveryStatus: 'DELIVERED',
              attempts: { increment: 1 },
              deliveredAt: now,
              lastError: null,
            },
          });
          return true;
        });
        if (!worked) break;
        delivered++;
      } catch (error) {
        if (!candidate) throw new Error('Project event queue is unavailable');
        const attempts = candidate.attempts + 1;
        const delay = PROJECT_EVENT_RETRIES_MS[attempts - 1];
        await this.db.projectEvent.updateMany({
          where: {
            id: candidate.id,
            attempts: candidate.attempts,
            deliveryStatus: { in: ['PENDING', 'RETRY'] },
            deliveredAt: null,
          },
          data: {
            attempts,
            deliveryStatus: delay === undefined ? 'FAILED' : 'RETRY',
            nextAttemptAt: new Date(this.clock().getTime() + (delay ?? 0)),
            lastError:
              typeof (error as { code?: unknown }).code === 'string' &&
              /^[A-Z0-9_]{1,40}$/.test((error as { code: string }).code)
                ? (error as { code: string }).code
                : 'PROJECT_EVENT_DELIVERY_FAILED',
          },
        });
        failed++;
      }
    }
    return { delivered, failed };
  }
}
