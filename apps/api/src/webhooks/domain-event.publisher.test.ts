import { describe, expect, it, vi } from 'vitest';
import { PrismaDomainEventPublisher } from './domain-event.publisher';

describe('PrismaDomainEventPublisher', () => {
  it('writes the complete envelope through the supplied transaction', async () => {
    const create = vi.fn(async ({ data }) => data);
    const fallback = { webhookEvent: { create: vi.fn() } } as never;
    const publisher = new PrismaDomainEventPublisher(fallback);
    const tx = { webhookEvent: { create } } as never;
    const event = await publisher.publish('task.opened', crypto.randomUUID(), { task_id: 'task' }, tx);
    expect(event).toMatchObject({ type: 'task.opened', version: 1, delivery_attempt: 0 });
    expect(create).toHaveBeenCalledOnce();
    expect((create.mock.calls[0]![0] as any).data.payload).toEqual(event);
  });
});
