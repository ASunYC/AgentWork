import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@agentwork/database';
import { TasksService } from './tasks.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { FakeLedgerPort } from '../ledger/ledger.port';
import {
  DomainEventPublisherPort,
  type DomainEventData,
  type DomainEventEnvelope,
  type DomainEventType,
  type PrismaTransaction,
} from '../webhooks/domain-event.publisher';

class Events extends DomainEventPublisherPort {
  readonly published: string[] = [];
  async publish(
    type: DomainEventType,
    _subjectId: string,
    _data: DomainEventData,
    _tx?: PrismaTransaction,
    _idempotencyKey?: string,
  ): Promise<DomainEventEnvelope> {
    this.published.push(type);
    return {} as DomainEventEnvelope;
  }
}

type Row = {
  id: string;
  publisherId: string;
  mode: 'CLAIM' | 'BID';
  status: string;
  version: number;
  budget: bigint;
  maxRevisions: number;
};
class ConcurrentFakeDb {
  task: Row = {
    id: crypto.randomUUID(),
    publisherId: crypto.randomUUID(),
    mode: 'CLAIM',
    status: 'OPEN',
    version: 1,
    budget: 100n,
    maxRevisions: 2,
  };
  agents = new Map<
    string,
    { id: string; ownerUserId: string; status: string }
  >();
  assignments: {
    id: string;
    taskId: string;
    agentId: string;
    releasedAt: null;
  }[] = [];
  events: unknown[] = [];
  private tail = Promise.resolve();
  $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const run = this.tail.then(() => work(this.tx()));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  private tx() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      $executeRaw: async () => 0,
      task: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === self.task.id ? { ...self.task } : null,
        findUniqueOrThrow: async () => ({ ...self.task }),
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; version: number; status: string };
          data: { status: string; version: { increment: number } };
        }) => {
          if (
            where.id !== self.task.id ||
            where.version !== self.task.version ||
            where.status !== self.task.status
          )
            return { count: 0 };
          self.task.status = data.status;
          self.task.version += data.version.increment;
          return { count: 1 };
        },
      },
      agent: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          self.agents.get(where.id) ?? null,
      },
      taskAssignment: {
        findFirst: async ({
          where,
        }: {
          where: { taskId: string; agentId?: string; releasedAt: null };
        }) =>
          self.assignments.find(
            (a) =>
              a.taskId === where.taskId &&
              (!where.agentId || a.agentId === where.agentId),
          ) ?? null,
        create: async ({
          data,
        }: {
          data: { taskId: string; agentId: string };
        }) => {
          const row = {
            id: crypto.randomUUID(),
            ...data,
            releasedAt: null as null,
          };
          self.assignments.push(row);
          return row;
        },
      },
      taskEvent: {
        create: async ({ data }: { data: unknown }) => {
          self.events.push(data);
          return data;
        },
      },
    };
  }
}

describe('task concurrency and settlement invariants', () => {
  it('allows only one assignment across 100 concurrent claims', async () => {
    const db = new ConcurrentFakeDb();
    const ledger = new FakeLedgerPort();
    const agents = Array.from({ length: 100 }, () => crypto.randomUUID());
    for (const id of agents)
      db.agents.set(id, {
        id,
        ownerUserId: crypto.randomUUID(),
        status: 'ACTIVE',
      });
    const events = new Events();
    const service = new TasksService(
      db as unknown as PrismaClient,
      ledger,
      events,
    );
    const results = await Promise.allSettled(
      agents.map((id) =>
        service.claim(
          { type: 'AGENT', id, requestId: crypto.randomUUID() },
          db.task.id,
          { version: 1 },
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(db.assignments).toHaveLength(1);
    expect(db.task.status).toBe('ASSIGNED');
    expect(db.events).toHaveLength(1);
    expect(events.published).toEqual(['task.assigned']);
  });
  it('settles an accepted delivery only once under retries', async () => {
    const db = new ConcurrentFakeDb();
    db.task.status = 'DELIVERED';
    db.assignments.push({
      id: crypto.randomUUID(),
      taskId: db.task.id,
      agentId: crypto.randomUUID(),
      releasedAt: null,
    });
    const ledger = new FakeLedgerPort();
    const service = new DeliveriesService(
      db as unknown as PrismaClient,
      ledger,
      new Events(),
    );
    const actor = {
      type: 'USER' as const,
      id: db.task.publisherId,
      requestId: crypto.randomUUID(),
    };
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.accept(actor, db.task.id, { version: 1 }),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(ledger.settlements).toHaveLength(1);
    expect(db.task.status).toBe('COMPLETED_SETTLED');
  });
});
