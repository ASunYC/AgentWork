import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@agentwork/database';
import type { ActorContext } from '../common/actor';
import { DomainError } from '../common/api-error';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class OperationsService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  async report(
    actor: ActorContext,
    ip: string | undefined,
    input: {
      resourceType: 'AGENT' | 'AGENT_POST' | 'TASK' | 'REVIEW';
      resourceId: string;
      reason: string;
    },
  ) {
    await this.assertResource(input.resourceType, input.resourceId);
    return this.db.auditLog.create({
      data: {
        actorType: actor.type,
        actorId: actor.id,
        action: 'content.report',
        resourceType: input.resourceType.toLowerCase(),
        resourceId: input.resourceId,
        after: { reason: input.reason, status: 'OPEN' },
        requestId: actor.requestId,
        ip,
      },
    });
  }

  async decide(
    adminId: string,
    requestId: string,
    reportId: string,
    input: { decision: 'DISMISS' | 'HIDE' | 'SUSPEND'; note: string },
  ) {
    return this.db.$transaction(async (tx) => {
      const report = await tx.auditLog.findUnique({ where: { id: reportId } });
      if (!report || report.action !== 'content.report')
        throw new DomainError('NOT_FOUND', 'Report not found', 404);
      const existing = await tx.auditLog.findFirst({
        where: {
          action: 'content.moderate',
          resourceType: 'report',
          resourceId: reportId,
        },
      });
      if (existing)
        throw new DomainError('ALREADY_MODERATED', 'Report already moderated');
      if (input.decision === 'HIDE') {
        if (report.resourceType === 'review')
          await tx.review.update({
            where: { id: report.resourceId },
            data: { status: 'HIDDEN' },
          });
        else if (report.resourceType === 'agent_post')
          await tx.agentPost.update({
            where: { id: report.resourceId },
            data: { visibility: 'PRIVATE' },
          });
        else
          throw new DomainError(
            'UNSUPPORTED_DECISION',
            'This resource cannot be hidden',
          );
      }
      if (input.decision === 'SUSPEND') {
        if (report.resourceType === 'agent')
          await tx.agent.update({
            where: { id: report.resourceId },
            data: { status: 'SUSPENDED' },
          });
        else
          throw new DomainError(
            'UNSUPPORTED_DECISION',
            'Only Agents can be suspended by content moderation',
          );
      }
      return tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'content.moderate',
          resourceType: 'report',
          resourceId: reportId,
          before: { status: 'OPEN' },
          after: input,
          requestId,
        },
      });
    });
  }

  async adjust(
    adminId: string,
    requestId: string,
    input: {
      ownerType: 'USER' | 'ORGANIZATION' | 'AGENT';
      ownerId: string;
      amount: bigint;
      reason: string;
      ticket: string;
      idempotencyKey: string;
    },
  ) {
    return this.db.$transaction(
      async (tx) => {
        const result = await this.ledger.adminAdjust(
          { ownerType: input.ownerType, ownerId: input.ownerId },
          input.amount,
          {
            operatorId: adminId,
            reason: `${input.reason} [ticket:${input.ticket}]`,
            idempotencyKey: input.idempotencyKey,
          },
          tx,
        );
        if (!result.duplicate)
          await tx.auditLog.create({
            data: {
              actorType: 'ADMIN',
              actorId: adminId,
              action: 'ledger.adjust',
              resourceType: 'ledger_transaction',
              resourceId: result.transactionId,
              after: {
                ownerType: input.ownerType,
                ownerId: input.ownerId,
                amount: input.amount.toString(),
                reason: input.reason,
                ticket: input.ticket,
                idempotencyKey: input.idempotencyKey,
              },
              requestId,
            },
          });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async list(resource: string, cursor?: string, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new DomainError('VALIDATION_ERROR', 'limit must be 1..100', 400);
    const page = {
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'desc' as const },
    };
    let rows: Array<{ id: string }>;
    if (resource === 'tasks') rows = await this.db.task.findMany(page);
    else if (resource === 'users') rows = await this.db.user.findMany(page);
    else if (resource === 'agents') rows = await this.db.agent.findMany(page);
    else if (resource === 'ledger')
      rows = await this.db.ledgerTransaction.findMany({
        ...page,
        include: { entries: true },
      });
    else if (resource === 'audit') rows = await this.db.auditLog.findMany(page);
    else if (resource === 'reports')
      rows = await this.db.auditLog.findMany({
        ...page,
        where: { action: 'content.report' },
      });
    else throw new DomainError('NOT_FOUND', 'Unknown admin resource', 404);
    const more = rows.length > limit;
    const items = more ? rows.slice(0, limit) : rows;
    return { items, nextCursor: more ? items.at(-1)!.id : null };
  }

  private async assertResource(type: string, id: string) {
    const found =
      type === 'AGENT'
        ? await this.db.agent.findUnique({
            where: { id },
            select: { id: true },
          })
        : type === 'AGENT_POST'
          ? await this.db.agentPost.findUnique({
              where: { id },
              select: { id: true },
            })
          : type === 'TASK'
            ? await this.db.task.findUnique({
                where: { id },
                select: { id: true },
              })
            : await this.db.review.findUnique({
                where: { id },
                select: { id: true },
              });
    if (!found)
      throw new DomainError('NOT_FOUND', 'Reported resource not found', 404);
  }
}
