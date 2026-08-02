import { Injectable } from '@nestjs/common';
import type { WalletOwnerType } from '@agentwork/contracts';
import { Prisma, type PrismaClient } from '@agentwork/database';
import { LedgerError } from './ledger.errors';
import type {
  AdminContext,
  OperationContext,
  TransactionResult,
  WalletSubject,
} from './ledger.types';
import { Inject } from '@nestjs/common';
import { PRISMA } from '../common/database';
import type {
  SignupGrantIntent,
  SignupGrantPort,
} from '../common/signup-grant.port';
import type { LedgerPort, LedgerRequest } from './ledger.port';

const PLATFORM_ID = '00000000-0000-7000-8000-000000000001';
type Tx = Prisma.TransactionClient;
type AccountType =
  'AVAILABLE' | 'FROZEN' | 'GRANT_POOL' | 'ESCROW' | 'FEE' | 'ADJUSTMENT';
type Entry = {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: bigint;
};

@Injectable()
export class LedgerService implements SignupGrantPort, LedgerPort {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async request(intent: SignupGrantIntent): Promise<void> {
    await this.grantSignupCoins(
      intent.subjectType,
      intent.subjectId,
      intent.fingerprint,
      intent.amount,
      intent.transaction as Tx | undefined,
    );
  }

  async freeze(request: LedgerRequest): Promise<void> {
    await this.freezeTaskBudget(
      request.publisherId,
      request.taskId,
      request.amount,
      {
        idempotencyKey: request.idempotencyKey,
      },
      request.transaction as Tx | undefined,
    );
  }

  async refund(request: LedgerRequest): Promise<void> {
    await this.refundTask(
      request.taskId,
      request.publisherId,
      request.amount,
      {
        idempotencyKey: request.idempotencyKey,
      },
      request.transaction as Tx | undefined,
    );
  }

  async settle(request: LedgerRequest): Promise<void> {
    if (!request.agentId)
      throw new LedgerError('INVALID_AMOUNT', 'Agent is required');
    await this.settleTask(
      request.taskId,
      request.agentId,
      request.amount,
      0n,
      {
        idempotencyKey: request.idempotencyKey,
      },
      request.transaction as Tx | undefined,
    );
  }

  async grantSignupCoins(
    ownerType: WalletOwnerType,
    ownerId: string,
    fingerprint: string,
    amount = 1000n,
    transaction?: Tx,
  ) {
    this.positive(amount);
    return this.inTransaction(transaction, async (tx) => {
      const existing = await tx.signupGrant.findFirst({
        where: { OR: [{ fingerprint }, { wallet: { ownerType, ownerId } }] },
      });
      if (existing)
        return { transactionId: existing.transactionId, granted: false };
      const wallet = await this.ensureWallet(tx, { ownerType, ownerId });
      const result = await this.post(
        tx,
        'SIGNUP_GRANT',
        'signup_grant',
        ownerId,
        `signup:${fingerprint}`,
        [
          {
            accountId: (await this.systemAccount(tx, 'GRANT_POOL')).id,
            direction: 'DEBIT',
            amount,
          },
          {
            accountId: (await this.account(tx, wallet.id, 'AVAILABLE')).id,
            direction: 'CREDIT',
            amount,
          },
        ],
        { fingerprint },
      );
      await tx.signupGrant.create({
        data: {
          walletId: wallet.id,
          fingerprint,
          transactionId: result.transactionId,
          amount,
        },
      });
      return { transactionId: result.transactionId, granted: true };
    });
  }

  freezeTaskBudget(
    publisherId: string,
    taskId: string,
    amount: bigint,
    context: OperationContext,
    transaction?: Tx,
  ) {
    return this.freeze(
      'TASK_FREEZE',
      publisherId,
      taskId,
      amount,
      context,
      transaction,
    );
  }
  increaseTaskBudget(
    publisherId: string,
    taskId: string,
    amount: bigint,
    context: OperationContext,
    transaction?: Tx,
  ) {
    return this.freeze(
      'TASK_BUDGET_INCREASE',
      publisherId,
      taskId,
      amount,
      context,
      transaction,
    );
  }
  private async freeze(
    type: 'TASK_FREEZE' | 'TASK_BUDGET_INCREASE',
    publisherId: string,
    taskId: string,
    amount: bigint,
    context: OperationContext,
    transaction?: Tx,
  ) {
    this.positive(amount);
    return this.inTransaction(transaction, async (tx) => {
      const duplicate = await this.duplicate(tx, context.idempotencyKey);
      if (duplicate) return duplicate;
      const wallet = await this.lockWallet(tx, 'USER', publisherId);
      const available = await this.account(tx, wallet.id, 'AVAILABLE');
      if ((await this.balance(tx, available.id)) < amount)
        throw new LedgerError(
          'INSUFFICIENT_COINS',
          'Insufficient available coins',
        );
      return this.post(tx, type, 'task', taskId, context.idempotencyKey, [
        { accountId: available.id, direction: 'DEBIT', amount },
        {
          accountId: (await this.account(tx, wallet.id, 'FROZEN')).id,
          direction: 'CREDIT',
          amount,
        },
      ]);
    });
  }

  async settleTask(
    taskId: string,
    agentId: string,
    amount: bigint,
    fee = 0n,
    context: OperationContext,
    transaction?: Tx,
  ) {
    this.positive(amount);
    if (fee < 0n || fee >= amount)
      throw new LedgerError('INVALID_AMOUNT', 'Invalid fee');
    return this.release(
      taskId,
      amount,
      context,
      async (tx, entries) => {
        const wallet = await this.ensureWallet(tx, {
          ownerType: 'AGENT',
          ownerId: agentId,
        });
        entries.push({
          accountId: (await this.account(tx, wallet.id, 'AVAILABLE')).id,
          direction: 'CREDIT',
          amount: amount - fee,
        });
        if (fee)
          entries.push({
            accountId: (await this.systemAccount(tx, 'FEE')).id,
            direction: 'CREDIT',
            amount: fee,
          });
        return this.post(
          tx,
          'TASK_SETTLEMENT',
          'task',
          taskId,
          context.idempotencyKey,
          entries,
        );
      },
      transaction,
    );
  }

  refundTask(
    taskId: string,
    publisherId: string,
    amount: bigint,
    context: OperationContext,
    transaction?: Tx,
  ) {
    this.positive(amount);
    return this.release(
      taskId,
      amount,
      context,
      async (tx, entries) => {
        const wallet = await this.lockWallet(tx, 'USER', publisherId);
        entries.push({
          accountId: (await this.account(tx, wallet.id, 'AVAILABLE')).id,
          direction: 'CREDIT',
          amount,
        });
        return this.post(
          tx,
          'FULL_REFUND',
          'task',
          taskId,
          context.idempotencyKey,
          entries,
        );
      },
      transaction,
    );
  }

  resolveDispute(
    taskId: string,
    publisherId: string,
    agentId: string,
    refundAmount: bigint,
    payoutAmount: bigint,
    context: OperationContext,
  ) {
    const total = refundAmount + payoutAmount;
    if (refundAmount < 0n || payoutAmount < 0n || total <= 0n)
      throw new LedgerError('INVALID_AMOUNT', 'Invalid dispute split');
    return this.release(taskId, total, context, async (tx, entries) => {
      if (refundAmount) {
        const w = await this.lockWallet(tx, 'USER', publisherId);
        entries.push({
          accountId: (await this.account(tx, w.id, 'AVAILABLE')).id,
          direction: 'CREDIT',
          amount: refundAmount,
        });
      }
      if (payoutAmount) {
        const w = await this.ensureWallet(tx, {
          ownerType: 'AGENT',
          ownerId: agentId,
        });
        entries.push({
          accountId: (await this.account(tx, w.id, 'AVAILABLE')).id,
          direction: 'CREDIT',
          amount: payoutAmount,
        });
      }
      return this.post(
        tx,
        'ARBITRATION_PAYOUT',
        'task',
        taskId,
        context.idempotencyKey,
        entries,
        {
          refundAmount: refundAmount.toString(),
          payoutAmount: payoutAmount.toString(),
        },
      );
    });
  }

  async adminAdjust(
    subject: WalletSubject,
    amount: bigint,
    context: AdminContext,
  ) {
    if (!amount)
      throw new LedgerError('INVALID_AMOUNT', 'Adjustment cannot be zero');
    return this.atomic(async (tx) => {
      const duplicate = await this.duplicate(tx, context.idempotencyKey);
      if (duplicate) return duplicate;
      const wallet = await this.lockWallet(
        tx,
        subject.ownerType,
        subject.ownerId,
      );
      const target = await this.account(tx, wallet.id, 'AVAILABLE');
      const system = await this.systemAccount(tx, 'ADJUSTMENT');
      if (amount < 0n && (await this.balance(tx, target.id)) < -amount)
        throw new LedgerError(
          'INSUFFICIENT_COINS',
          'Adjustment would make balance negative',
        );
      const n = amount < 0n ? -amount : amount;
      const entries: Entry[] =
        amount > 0n
          ? [
              { accountId: system.id, direction: 'DEBIT', amount: n },
              { accountId: target.id, direction: 'CREDIT', amount: n },
            ]
          : [
              { accountId: target.id, direction: 'DEBIT', amount: n },
              { accountId: system.id, direction: 'CREDIT', amount: n },
            ];
      return this.post(
        tx,
        'ADMIN_ADJUSTMENT',
        'wallet',
        wallet.id,
        context.idempotencyKey,
        entries,
        { reason: context.reason, operatorId: context.operatorId },
      );
    });
  }

  async reverseTransaction(originalId: string, context: AdminContext) {
    return this.atomic(async (tx) => {
      const duplicate = await this.duplicate(tx, context.idempotencyKey);
      if (duplicate) return duplicate;
      const original = await tx.ledgerTransaction.findUnique({
        where: { id: originalId },
        include: { entries: true },
      });
      const reversed = await tx.ledgerTransaction.findFirst({
        where: { type: 'REVERSAL', referenceId: originalId, status: 'POSTED' },
      });
      if (
        !original ||
        original.status !== 'POSTED' ||
        original.type === 'REVERSAL' ||
        reversed
      )
        throw new LedgerError(
          'TRANSACTION_NOT_REVERSIBLE',
          'Transaction is not reversible',
        );
      for (const entry of original.entries.filter(
        (e) => e.direction === 'CREDIT',
      ))
        if ((await this.balance(tx, entry.accountId)) < entry.amount)
          throw new LedgerError(
            'INSUFFICIENT_COINS',
            'Reversal would make balance negative',
          );
      const result = await this.post(
        tx,
        'REVERSAL',
        'ledger_transaction',
        originalId,
        context.idempotencyKey,
        original.entries.map((e) => ({
          accountId: e.accountId,
          amount: e.amount,
          direction: e.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        })),
        { reason: context.reason, operatorId: context.operatorId },
      );
      return result;
    });
  }

  async getWallet(subject: WalletSubject) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { ownerType_ownerId: subject },
      include: { accounts: true },
    });
    if (!wallet)
      throw new LedgerError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    const a = wallet.accounts.find((x) => x.type === 'AVAILABLE');
    const f = wallet.accounts.find((x) => x.type === 'FROZEN');
    return {
      walletId: wallet.id,
      ...subject,
      available: a ? (await this.balance(this.prisma, a.id)).toString() : '0',
      frozen: f ? (await this.balance(this.prisma, f.id)).toString() : '0',
    };
  }

  async listTransactions(subject: WalletSubject, cursor?: string, limit = 20) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { ownerType_ownerId: subject },
    });
    if (!wallet)
      throw new LedgerError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    const rows = await this.prisma.ledgerTransaction.findMany({
      where: {
        status: { in: ['POSTED', 'REVERSED'] },
        entries: { some: { account: { walletId: wallet.id } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        entries: {
          where: { account: { walletId: wallet.id } },
          include: { account: true },
        },
      },
    });
    return {
      items: rows.slice(0, limit).map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        createdAt: r.createdAt.toISOString(),
        entries: r.entries.map((e) => ({
          accountType: e.account.type,
          direction: e.direction,
          amount: e.amount.toString(),
        })),
      })),
      nextCursor: rows.length > limit ? rows[limit - 1]?.id : undefined,
    };
  }

  private release(
    taskId: string,
    amount: bigint,
    context: OperationContext,
    fn: (tx: Tx, entries: Entry[]) => Promise<TransactionResult>,
    transaction?: Tx,
  ) {
    return this.inTransaction(transaction, async (tx) => {
      const duplicate = await this.duplicate(tx, context.idempotencyKey);
      if (duplicate) return duplicate;
      const frozen = await this.taskFrozen(tx, taskId);
      if (!frozen || frozen.balance < amount)
        throw new LedgerError(
          'INSUFFICIENT_COINS',
          'Task frozen balance is insufficient',
        );
      return fn(tx, [
        { accountId: frozen.accountId, direction: 'DEBIT', amount },
      ]);
    });
  }
  private async taskFrozen(tx: Tx, taskId: string) {
    const rows = await tx.ledgerEntry.findMany({
      where: {
        account: { type: 'FROZEN' },
        transaction: {
          referenceType: 'task',
          referenceId: taskId,
          status: 'POSTED',
        },
      },
    });
    if (!rows[0]) return undefined;
    return {
      accountId: rows[0].accountId,
      balance: rows.reduce(
        (s, e) => s + (e.direction === 'CREDIT' ? e.amount : -e.amount),
        0n,
      ),
    };
  }
  private async post(
    tx: Tx,
    type: Prisma.LedgerTransactionCreateInput['type'],
    referenceType: string,
    referenceId: string,
    key: string,
    entries: Entry[],
    metadata?: Prisma.InputJsonValue,
  ) {
    if (!key)
      throw new LedgerError(
        'DUPLICATE_OPERATION',
        'Idempotency key is required',
      );
    const d = entries
      .filter((e) => e.direction === 'DEBIT')
      .reduce((s, e) => s + e.amount, 0n);
    const c = entries
      .filter((e) => e.direction === 'CREDIT')
      .reduce((s, e) => s + e.amount, 0n);
    if (entries.length < 2 || d !== c || entries.some((e) => e.amount <= 0n))
      throw new LedgerError(
        'LEDGER_IMBALANCE',
        'Entries must be positive and balanced',
      );
    const row = await tx.ledgerTransaction.create({
      data: {
        type,
        referenceType,
        referenceId,
        idempotencyKey: key,
        metadata,
        entries: { create: entries },
      },
    });
    await tx.ledgerTransaction.update({
      where: { id: row.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });
    return { transactionId: row.id, duplicate: false };
  }
  private async duplicate(tx: Tx, key: string) {
    if (!key)
      throw new LedgerError(
        'DUPLICATE_OPERATION',
        'Idempotency key is required',
      );
    const row = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: key },
    });
    return row ? { transactionId: row.id, duplicate: true } : undefined;
  }
  private positive(n: bigint) {
    if (typeof n !== 'bigint' || n <= 0n)
      throw new LedgerError(
        'INVALID_AMOUNT',
        'Amount must be a positive bigint',
      );
  }
  private atomic<T>(fn: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
  private inTransaction<T>(
    transaction: Tx | undefined,
    fn: (tx: Tx) => Promise<T>,
  ) {
    return transaction ? fn(transaction) : this.atomic(fn);
  }
  private ensureWallet(tx: Tx, subject: WalletSubject) {
    return tx.wallet.upsert({
      where: { ownerType_ownerId: subject },
      update: {},
      create: subject,
    });
  }
  private async lockWallet(
    tx: Tx,
    ownerType: WalletOwnerType,
    ownerId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM wallets WHERE owner_type = ${ownerType}::"WalletOwnerType" AND owner_id = ${ownerId}::uuid FOR UPDATE`;
    if (!rows[0])
      throw new LedgerError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    return tx.wallet.findUniqueOrThrow({ where: { id: rows[0].id } });
  }
  private account(tx: Tx, walletId: string, type: AccountType) {
    return tx.ledgerAccount.upsert({
      where: {
        walletId_type_currencyCode: { walletId, type, currencyCode: 'COIN' },
      },
      update: {},
      create: { walletId, type, currencyCode: 'COIN' },
    });
  }
  private async systemAccount(tx: Tx, type: AccountType) {
    const wallet = await tx.wallet.upsert({
      where: {
        ownerType_ownerId: { ownerType: 'PLATFORM', ownerId: PLATFORM_ID },
      },
      update: {},
      create: { ownerType: 'PLATFORM', ownerId: PLATFORM_ID },
    });
    return this.account(tx, wallet.id, type);
  }
  private async balance(tx: Tx | PrismaClient, accountId: string) {
    const rows = await tx.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountId, transaction: { status: 'POSTED' } },
      _sum: { amount: true },
    });
    return rows.reduce(
      (s, r) =>
        s +
        (r.direction === 'CREDIT'
          ? (r._sum.amount ?? 0n)
          : -(r._sum.amount ?? 0n)),
      0n,
    );
  }
}
