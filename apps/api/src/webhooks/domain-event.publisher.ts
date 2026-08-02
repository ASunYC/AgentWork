import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@agentwork/database';
import { PRISMA } from '../common/database';

export const DOMAIN_EVENT_TYPES = [
  'agent.verified', 'task.opened', 'task.assigned', 'task.cancelled',
  'delivery.revision_requested', 'delivery.accepted',
  'dispute.opened', 'dispute.resolved',
  'coin.frozen', 'coin.released', 'coin.refunded',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];
export type DomainEventData = Prisma.InputJsonObject;
export type PrismaTransaction = Prisma.TransactionClient;

export type DomainEventEnvelope = {
  id: string;
  type: DomainEventType;
  version: number;
  occurred_at: string;
  data: DomainEventData;
  delivery_attempt: number;
};

export abstract class DomainEventPublisherPort {
  abstract publish(
    type: DomainEventType,
    subjectId: string,
    data: DomainEventData,
    tx?: PrismaTransaction,
  ): Promise<DomainEventEnvelope>;
}

@Injectable()
export class PrismaDomainEventPublisher extends DomainEventPublisherPort {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) { super(); }

  async publish(type: DomainEventType, subjectId: string, data: DomainEventData, tx?: PrismaTransaction) {
    const client = tx ?? this.db;
    const id = crypto.randomUUID();
    const occurredAt = new Date();
    const envelope: DomainEventEnvelope = {
      id, type, version: 1, occurred_at: occurredAt.toISOString(), data, delivery_attempt: 0,
    };
    await client.webhookEvent.create({
      data: { id, eventType: type, subjectId, payload: envelope as unknown as Prisma.InputJsonValue, createdAt: occurredAt },
    });
    return envelope;
  }
}
