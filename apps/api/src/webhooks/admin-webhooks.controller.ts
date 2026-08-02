import { CanActivate, Controller, ExecutionContext, Get, Injectable, Param, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaClient } from '@agentwork/database';
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) { const expected = process.env.ADMIN_API_KEY; if (!expected || ctx.switchToHttp().getRequest<Request>().header('x-admin-key') !== expected) throw new UnauthorizedException('Admin authentication required'); return true; }
}
@Controller('v1/admin/webhook-deliveries') @UseGuards(AdminGuard)
export class AdminWebhooksController {
  constructor(private readonly db: PrismaClient) {}
  @Get('failed') list(@Query('status') status?: string) { return this.db.webhookDelivery.findMany({ where: { status: status === 'RETRYING' ? 'RETRYING' : 'DEAD_LETTER' }, include: { event: true, endpoint: true }, orderBy: { createdAt: 'desc' }, take: 100 }); }
  @Post(':id/replay') async replay(@Param('id') id: string) { const current = await this.db.webhookDelivery.findUniqueOrThrow({ where: { id } }); return this.db.webhookDelivery.upsert({ where: { eventId_endpointId_attempt: { eventId: current.eventId, endpointId: current.endpointId, attempt: current.attempt + 1 } }, create: { eventId: current.eventId, endpointId: current.endpointId, attempt: current.attempt + 1, status: 'PENDING' }, update: { status: 'PENDING', nextRetryAt: null } }); }
}
