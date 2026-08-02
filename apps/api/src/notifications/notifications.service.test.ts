import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
describe('NotificationsService', () => {
  it('rejects reading another users notification', async () => {
    const service = new NotificationsService({ notification: { findUnique: vi.fn(async () => ({ id: 'n', recipientId: 'other' })) } } as never);
    await expect(service.read('mine', 'n')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('returns an opaque id cursor', async () => {
    const findMany = vi.fn(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const page = await new NotificationsService({ notification: { findMany } } as never).list('u', undefined, 2);
    expect(page).toEqual({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' });
  });
});
