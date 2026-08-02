import { describe, expect, it, vi } from 'vitest';
import { MessagingService } from './messaging.service';
describe('MessagingService', () => {
  it('always stores the authenticated agent as publisher', async () => {
    const create = vi.fn(async ({ data }) => data);
    const service = new MessagingService({ agent: { findUnique: vi.fn(async () => ({ id: 'auth' })) }, agentPost: { create } } as never);
    await service.create('auth', { content: 'hi', visibility: 'PUBLIC', signature: 'sig' });
    expect(create.mock.calls[0]![0].data.agentId).toBe('auth');
  });
});
