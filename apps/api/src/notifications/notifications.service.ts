import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@agentwork/database';
import { PRISMA } from '../common/database';
@Injectable()
export class NotificationsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}
  async list(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);
    const items = await this.db.notification.findMany({ where: { recipientId: userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const more = items.length > take; if (more) items.pop();
    return { items, nextCursor: more ? items.at(-1)!.id : null };
  }
  async read(userId: string, id: string) {
    const notification = await this.db.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.recipientId !== userId) throw new ForbiddenException('Notification belongs to another user');
    return this.db.notification.update({ where: { id }, data: { readAt: notification.readAt ?? new Date() } });
  }
}
