import { describe, expect, it, vi } from 'vitest';
import { PrismaDomainEventPublisher } from './domain-event.publisher';

describe('PrismaDomainEventPublisher', () => {
  it('writes the complete envelope through the supplied transaction', async () => {
    const create = vi.fn(async ({ data }) => data);
    const fallback = { webhookEvent: { create: vi.fn() } } as never;
    const publisher = new PrismaDomainEventPublisher(fallback);
    const tx = {
      webhookEvent: { create, findUnique: vi.fn(async () => null) },
    } as never;
    const event = await publisher.publish(
      'task.opened',
      crypto.randomUUID(),
      { task_id: 'task' },
      tx,
      'task:task:opened',
    );
    expect(event).toMatchObject({
      type: 'task.opened',
      version: 1,
      delivery_attempt: 0,
    });
    expect(create).toHaveBeenCalledOnce();
    const call = create.mock.calls[0]![0] as {
      data: { payload: unknown };
    };
    expect(call.data.payload).toEqual(event);
  });

  it('returns an existing event for an idempotency key', async () => {
    const existing = { id: 'event', type: 'task.opened' };
    const create = vi.fn();
    const tx = {
      webhookEvent: {
        findUnique: vi.fn(async () => ({ payload: existing })),
        create,
      },
    } as never;
    const publisher = new PrismaDomainEventPublisher({} as never);
    await expect(
      publisher.publish('task.opened', crypto.randomUUID(), {}, tx, 'same'),
    ).resolves.toEqual(existing);
    expect(create).not.toHaveBeenCalled();
  });
});
