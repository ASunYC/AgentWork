import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@agentwork/database';
import type { ActorContext } from '../common/actor';
import { DomainError } from '../common/api-error';
import { LEDGER_PORT, type LedgerPort } from '../ledger/ledger.port';

type Json = Prisma.InputJsonValue;
type TaskInput = {
  title: string;
  objective: string;
  mode: 'CLAIM' | 'BID';
  visibility?: 'PUBLIC' | 'INVITED' | 'PRIVATE';
  budget: bigint;
  deadline?: Date;
  maxRevisions?: number;
  deliverables: unknown;
  constraints?: unknown;
  acceptanceCriteria: unknown;
  capabilities?: string[];
};
type Versioned = { version: number };

@Injectable()
export class TasksService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
  ) {}
  private user(actor: ActorContext) {
    if (actor.type !== 'USER')
      throw new DomainError(
        'FORBIDDEN',
        'Publisher action requires a user',
        403,
      );
  }
  private agent(actor: ActorContext) {
    if (actor.type !== 'AGENT')
      throw new DomainError('FORBIDDEN', 'Agent action requires an agent', 403);
  }
  private async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  }
  private async event(
    tx: Prisma.TransactionClient,
    taskId: string,
    actor: ActorContext,
    type: string,
    payload: Json = {},
  ) {
    await tx.taskEvent.create({
      data: { taskId, actorType: actor.type, actorId: actor.id, type, payload },
    });
  }
  private failUpdate(count: number) {
    if (!count)
      throw new DomainError(
        'VERSION_CONFLICT',
        'Task state or version changed',
        409,
      );
  }
  private async assigned(
    tx: Prisma.TransactionClient,
    taskId: string,
    agentId: string,
  ) {
    const a = await tx.taskAssignment.findFirst({
      where: { taskId, agentId, releasedAt: null },
    });
    if (!a)
      throw new DomainError('FORBIDDEN', 'Agent is not assigned to task', 403);
    return a;
  }
  private async activeAgent(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    publisherId: string,
  ) {
    this.agent(actor);
    const agent = await tx.agent.findUnique({ where: { id: actor.id } });
    if (!agent || agent.status !== 'ACTIVE')
      throw new DomainError('AGENT_INACTIVE', 'Agent must be active', 403);
    if (agent.ownerUserId === publisherId)
      throw new DomainError(
        'SELF_ASSIGNMENT',
        'Publisher-owned agent cannot take this task',
        403,
      );
  }

  async create(actor: ActorContext, input: TaskInput) {
    this.user(actor);
    return this.db.task.create({
      data: {
        publisherId: actor.id,
        title: input.title,
        objective: input.objective,
        mode: input.mode,
        visibility: input.visibility,
        budget: input.budget,
        deadline: input.deadline,
        maxRevisions: input.maxRevisions,
        requirement: {
          create: {
            deliverables: input.deliverables as Json,
            constraints: input.constraints as Json | undefined,
            acceptanceCriteria: input.acceptanceCriteria as Json,
            capabilities: input.capabilities ?? [],
          },
        },
        events: {
          create: {
            actorType: actor.type,
            actorId: actor.id,
            type: 'task.created',
            payload: {},
          },
        },
      },
      include: { requirement: true },
    });
  }
  async update(
    actor: ActorContext,
    id: string,
    input: Partial<TaskInput> & Versioned,
  ) {
    this.user(actor);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const task = await tx.task.findUnique({ where: { id } });
      if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
      if (task.publisherId !== actor.id)
        throw new DomainError('FORBIDDEN', 'Not task publisher', 403);
      if (task.status !== 'DRAFT')
        throw new DomainError('INVALID_STATE', 'Only drafts can be edited');
      const { version, ...data } = input;
      const requirementKeys = [
        'deliverables',
        'constraints',
        'acceptanceCriteria',
        'capabilities',
      ] as const;
      const taskData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data))
        if (!requirementKeys.includes(k as (typeof requirementKeys)[number]))
          taskData[k] = v;
      const result = await tx.task.updateMany({
        where: { id, version, status: 'DRAFT' },
        data: { ...taskData, version: { increment: 1 } },
      });
      this.failUpdate(result.count);
      if (requirementKeys.some((k) => k in data))
        await tx.taskRequirement.update({
          where: { taskId: id },
          data: {
            deliverables: data.deliverables as Json | undefined,
            constraints: data.constraints as Json | undefined,
            acceptanceCriteria: data.acceptanceCriteria as Json | undefined,
            capabilities: data.capabilities,
          },
        });
      await this.event(tx, id, actor, 'task.updated', { version });
      return tx.task.findUniqueOrThrow({
        where: { id },
        include: { requirement: true },
      });
    });
  }
  async publish(actor: ActorContext, id: string, { version }: Versioned) {
    this.user(actor);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const task = await tx.task.findUnique({ where: { id } });
      if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
      if (task.publisherId !== actor.id)
        throw new DomainError('FORBIDDEN', 'Not task publisher', 403);
      if (task.status !== 'DRAFT')
        throw new DomainError('INVALID_STATE', 'Only drafts can be published');
      await this.ledger.freeze({
        taskId: id,
        publisherId: actor.id,
        amount: task.budget,
        idempotencyKey: `task:${id}:freeze`,
        transaction: tx,
      });
      const r = await tx.task.updateMany({
        where: { id, version, status: 'DRAFT' },
        data: { status: 'OPEN', version: { increment: 1 } },
      });
      this.failUpdate(r.count);
      await this.event(tx, id, actor, 'task.published', {
        amount: task.budget.toString(),
      });
      return tx.task.findUniqueOrThrow({ where: { id } });
    });
  }
  async cancel(actor: ActorContext, id: string, { version }: Versioned) {
    this.user(actor);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const task = await tx.task.findUnique({ where: { id } });
      if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
      if (task.publisherId !== actor.id)
        throw new DomainError('FORBIDDEN', 'Not task publisher', 403);
      if (
        task.status !== 'OPEN' ||
        (await tx.taskAssignment.findFirst({
          where: { taskId: id, releasedAt: null },
        }))
      )
        throw new DomainError(
          'INVALID_STATE',
          'Only unassigned open tasks can be cancelled',
        );
      await this.ledger.refund({
        taskId: id,
        publisherId: actor.id,
        amount: task.budget,
        idempotencyKey: `task:${id}:refund`,
        transaction: tx,
      });
      const r = await tx.task.updateMany({
        where: { id, version, status: 'OPEN' },
        data: { status: 'CANCELLED_REFUNDED', version: { increment: 1 } },
      });
      this.failUpdate(r.count);
      await this.event(tx, id, actor, 'task.cancelled', {});
      return tx.task.findUniqueOrThrow({ where: { id } });
    });
  }
  async claim(actor: ActorContext, id: string, { version }: Versioned) {
    this.agent(actor);
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, id);
        const task = await tx.task.findUnique({ where: { id } });
        if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
        await this.activeAgent(tx, actor, task.publisherId);
        if (task.mode !== 'CLAIM' || task.status !== 'OPEN')
          throw new DomainError('INVALID_STATE', 'Task is not open for claims');
        if (
          await tx.taskAssignment.findFirst({
            where: { taskId: id, releasedAt: null },
          })
        )
          throw new DomainError('ALREADY_ASSIGNED', 'Task already assigned');
        const r = await tx.task.updateMany({
          where: { id, version, status: 'OPEN' },
          data: { status: 'ASSIGNED', version: { increment: 1 } },
        });
        this.failUpdate(r.count);
        const assignment = await tx.taskAssignment.create({
          data: { taskId: id, agentId: actor.id },
        });
        await this.event(tx, id, actor, 'task.claimed', {
          assignmentId: assignment.id,
        });
        return assignment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async bid(
    actor: ActorContext,
    id: string,
    input: { amount: bigint; proposal: string; eta: Date; version: number },
  ) {
    this.agent(actor);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const task = await tx.task.findUnique({ where: { id } });
      if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
      await this.activeAgent(tx, actor, task.publisherId);
      if (
        task.mode !== 'BID' ||
        task.status !== 'OPEN' ||
        task.version !== input.version
      )
        throw new DomainError('INVALID_STATE', 'Task is not open for bids');
      if (input.amount > task.budget)
        throw new DomainError('BID_OVER_BUDGET', 'Bid exceeds task budget');
      if (
        await tx.bid.findFirst({
          where: { taskId: id, agentId: actor.id, status: 'ACTIVE' },
        })
      )
        throw new DomainError(
          'DUPLICATE_BID',
          'Agent already has an active bid',
        );
      const bid = await tx.bid.create({
        data: {
          taskId: id,
          agentId: actor.id,
          amount: input.amount,
          proposal: input.proposal,
          eta: input.eta,
        },
      });
      await this.event(tx, id, actor, 'bid.created', { bidId: bid.id });
      return bid;
    });
  }
  async bids(actor: ActorContext, id: string) {
    const task = await this.db.task.findUnique({ where: { id } });
    if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
    if (actor.type === 'USER' && task.publisherId !== actor.id)
      throw new DomainError('FORBIDDEN', 'Only publisher can view bids', 403);
    if (actor.type === 'AGENT')
      return this.db.bid.findMany({
        where: { taskId: id, agentId: actor.id },
        orderBy: { createdAt: 'desc' },
      });
    return this.db.bid.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'desc' },
    });
  }
  async selectBid(
    actor: ActorContext,
    id: string,
    input: { bidId: string; version: number },
  ) {
    this.user(actor);
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, id);
        const task = await tx.task.findUnique({ where: { id } });
        if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
        if (task.publisherId !== actor.id)
          throw new DomainError('FORBIDDEN', 'Not task publisher', 403);
        if (task.mode !== 'BID' || task.status !== 'OPEN')
          throw new DomainError(
            'INVALID_STATE',
            'Task is not open for selection',
          );
        const bid = await tx.bid.findFirst({
          where: { id: input.bidId, taskId: id, status: 'ACTIVE' },
        });
        if (!bid)
          throw new DomainError('BID_NOT_FOUND', 'Active bid not found', 404);
        const r = await tx.task.updateMany({
          where: { id, version: input.version, status: 'OPEN' },
          data: { status: 'ASSIGNED', version: { increment: 1 } },
        });
        this.failUpdate(r.count);
        await tx.taskAssignment.create({
          data: { taskId: id, agentId: bid.agentId, bidId: bid.id },
        });
        await tx.bid.update({
          where: { id: bid.id },
          data: { status: 'SELECTED' },
        });
        await tx.bid.updateMany({
          where: { taskId: id, status: 'ACTIVE', id: { not: bid.id } },
          data: { status: 'REJECTED' },
        });
        await this.event(tx, id, actor, 'bid.selected', {
          bidId: bid.id,
          agentId: bid.agentId,
        });
        return tx.task.findUniqueOrThrow({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async transitionAgent(
    actor: ActorContext,
    id: string,
    version: number,
    kind: 'start' | 'release' | 'progress',
    payload: Json = {},
  ) {
    this.agent(actor);
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const task = await tx.task.findUnique({ where: { id } });
      if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
      await this.assigned(tx, id, actor.id);
      if (kind === 'progress') {
        if (!['ASSIGNED', 'IN_PROGRESS'].includes(task.status))
          throw new DomainError('INVALID_STATE', 'Progress not allowed');
        await this.event(tx, id, actor, 'task.progress', payload);
        return task;
      }
      const from = kind === 'start' ? 'ASSIGNED' : 'ASSIGNED',
        to = kind === 'start' ? 'IN_PROGRESS' : 'OPEN';
      if (task.status !== from)
        throw new DomainError('INVALID_STATE', `${kind} not allowed`);
      const r = await tx.task.updateMany({
        where: { id, version, status: from },
        data: { status: to, version: { increment: 1 } },
      });
      this.failUpdate(r.count);
      if (kind === 'release')
        await tx.taskAssignment.updateMany({
          where: { taskId: id, agentId: actor.id, releasedAt: null },
          data: { releasedAt: new Date() },
        });
      await this.event(tx, id, actor, `task.${kind}`, payload);
      return tx.task.findUniqueOrThrow({ where: { id } });
    });
  }
  async list(
    actor: ActorContext,
    q: {
      cursor?: string;
      limit: number;
      status?: string;
      mode?: string;
      publisherId?: string;
    },
  ) {
    const visibility =
      actor.type === 'USER'
        ? { OR: [{ visibility: 'PUBLIC' as const }, { publisherId: actor.id }] }
        : { visibility: 'PUBLIC' as const };
    const items = await this.db.task.findMany({
      where: {
        ...visibility,
        status: q.status as never,
        mode: q.mode as never,
        publisherId: q.publisherId,
      },
      take: q.limit + 1,
      skip: q.cursor ? 1 : 0,
      cursor: q.cursor ? { id: q.cursor } : undefined,
      orderBy: { id: 'asc' },
      include: { requirement: true },
    });
    const hasMore = items.length > q.limit;
    if (hasMore) items.pop();
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  }
  async get(actor: ActorContext, id: string) {
    const task = await this.db.task.findUnique({
      where: { id },
      include: {
        requirement: true,
        assignments: { where: { releasedAt: null } },
        deliveries: true,
        events: true,
      },
    });
    if (!task) throw new DomainError('NOT_FOUND', 'Task not found', 404);
    if (task.visibility !== 'PUBLIC') {
      if (actor.type === 'USER' && task.publisherId !== actor.id)
        throw new DomainError('FORBIDDEN', 'Private task', 403);
      if (
        actor.type === 'AGENT' &&
        !task.assignments.some((a) => a.agentId === actor.id)
      )
        throw new DomainError('FORBIDDEN', 'Private task', 403);
    }
    return task;
  }
}
