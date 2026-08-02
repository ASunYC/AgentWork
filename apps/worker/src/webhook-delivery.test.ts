import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@agentwork/database';
import { signWebhook, WebhookDeliveryEngine } from './webhook-delivery.js';

describe('webhook delivery', () => {
  it('signs deterministically', () =>
    expect(signWebhook('secret', '123', '{}')).toBe(
      signWebhook('secret', '123', '{}'),
    ));
  it('marks a fifth failure dead letter', async () => {
    const update = vi.fn();
    const engine = new WebhookDeliveryEngine(
      { webhookDelivery: { update } } as unknown as PrismaClient,
      'master',
      async () => new Response('no', { status: 500 }),
      () => new Date(0),
    );
    await engine.deliver({
      id: 'd',
      eventId: 'event',
      endpointId: 'e',
      attempt: 5,
      event: { payload: {} },
      endpoint: {
        id: 'e',
        webhookUrl: 'https://example.test',
        secretVersion: 1,
      },
    });
    expect(update.mock.calls[0]![0].data.status).toBe('DEAD_LETTER');
  });
});
