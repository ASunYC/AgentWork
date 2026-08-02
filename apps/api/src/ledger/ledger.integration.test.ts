import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { PrismaClient } from '@agentwork/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerService } from './ledger.service';
import { PrismaService } from './prisma.service';

const execFileAsync = promisify(execFile);
const prismaCli = require.resolve('prisma/build/index.js');
let container: StartedPostgreSqlContainer;
let client: PrismaClient;
let service: LedgerService;

async function balance(ownerType: 'USER' | 'AGENT', ownerId: string) {
  return service.getWallet({ ownerType, ownerId });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ledger_test')
    .withUsername('agentwork')
    .withPassword('agentwork_test')
    .start();
  process.env.DATABASE_URL = container.getConnectionUri();
  await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '../../../../packages/database'),
    env: process.env,
  });
  client = new PrismaClient();
  service = new LedgerService(client as PrismaService);
}, 120_000);

afterAll(async () => {
  await client?.$disconnect();
  await container?.stop();
});

describe.sequential('LedgerService PostgreSQL integration', () => {
  it('grants signup coins once for repeated owner and fingerprint', async () => {
    const ownerId = crypto.randomUUID();
    const first = await service.grantSignupCoins(
      'USER',
      ownerId,
      'same-person',
    );
    const repeated = await service.grantSignupCoins(
      'USER',
      ownerId,
      'same-person',
    );
    const otherOwner = await service.grantSignupCoins(
      'USER',
      crypto.randomUUID(),
      'same-person',
    );

    expect(first.granted).toBe(true);
    expect(repeated).toEqual({
      transactionId: first.transactionId,
      granted: false,
    });
    expect(otherOwner).toEqual({
      transactionId: first.transactionId,
      granted: false,
    });
    expect((await balance('USER', ownerId)).available).toBe('1000');
    expect(
      await client.signupGrant.count({ where: { fingerprint: 'same-person' } }),
    ).toBe(1);
  });

  it('returns the original transaction for a repeated idempotency key', async () => {
    const publisherId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await service.grantSignupCoins('USER', publisherId, crypto.randomUUID());
    const first = await service.freezeTaskBudget(publisherId, taskId, 300n, {
      idempotencyKey: `freeze:${taskId}`,
    });
    const duplicate = await service.freezeTaskBudget(
      publisherId,
      taskId,
      300n,
      { idempotencyKey: `freeze:${taskId}` },
    );

    expect(duplicate).toEqual({
      transactionId: first.transactionId,
      duplicate: true,
    });
    expect(await balance('USER', publisherId)).toMatchObject({
      available: '700',
      frozen: '300',
    });
  });

  it('does not overdraw under concurrent freezes', async () => {
    const publisherId = crypto.randomUUID();
    await service.grantSignupCoins('USER', publisherId, crypto.randomUUID());
    const attempts = await Promise.allSettled([
      service.freezeTaskBudget(publisherId, crypto.randomUUID(), 700n, {
        idempotencyKey: crypto.randomUUID(),
      }),
      service.freezeTaskBudget(publisherId, crypto.randomUUID(), 700n, {
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);

    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const wallet = await balance('USER', publisherId);
    expect(wallet).toMatchObject({ available: '300', frozen: '700' });
  });

  it('settles frozen task funds to an agent and fee account', async () => {
    const publisherId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await service.grantSignupCoins('USER', publisherId, crypto.randomUUID());
    await service.freezeTaskBudget(publisherId, taskId, 400n, {
      idempotencyKey: `freeze:${taskId}`,
    });
    await service.settleTask(taskId, agentId, 400n, 25n, {
      idempotencyKey: `settle:${taskId}`,
    });

    expect(await balance('USER', publisherId)).toMatchObject({
      available: '600',
      frozen: '0',
    });
    expect(await balance('AGENT', agentId)).toMatchObject({
      available: '375',
      frozen: '0',
    });
  });

  it('refunds frozen funds to the publisher', async () => {
    const publisherId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await service.grantSignupCoins('USER', publisherId, crypto.randomUUID());
    await service.freezeTaskBudget(publisherId, taskId, 450n, {
      idempotencyKey: `freeze:${taskId}`,
    });
    await service.refundTask(taskId, publisherId, 450n, {
      idempotencyKey: `refund:${taskId}`,
    });
    expect(await balance('USER', publisherId)).toMatchObject({
      available: '1000',
      frozen: '0',
    });
  });

  it('splits a dispute between publisher and agent', async () => {
    const publisherId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await service.grantSignupCoins('USER', publisherId, crypto.randomUUID());
    await service.freezeTaskBudget(publisherId, taskId, 600n, {
      idempotencyKey: `freeze:${taskId}`,
    });
    await service.resolveDispute(taskId, publisherId, agentId, 250n, 350n, {
      idempotencyKey: `dispute:${taskId}`,
    });
    expect(await balance('USER', publisherId)).toMatchObject({
      available: '650',
      frozen: '0',
    });
    expect(await balance('AGENT', agentId)).toMatchObject({ available: '350' });
  });

  it('rolls back failed releases and never produces negative balances', async () => {
    const publisherId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await service.grantSignupCoins('USER', publisherId, crypto.randomUUID());
    await service.freezeTaskBudget(publisherId, taskId, 100n, {
      idempotencyKey: `freeze:${taskId}`,
    });
    const before = await client.ledgerTransaction.count();
    await expect(
      service.refundTask(taskId, publisherId, 101n, {
        idempotencyKey: `bad-refund:${taskId}`,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    expect(await client.ledgerTransaction.count()).toBe(before);
    expect(await balance('USER', publisherId)).toMatchObject({
      available: '900',
      frozen: '100',
    });

    const wallets = await client.wallet.findMany({
      where: { ownerType: { in: ['USER', 'AGENT'] } },
    });
    for (const wallet of wallets) {
      const projected = await service.getWallet({
        ownerType: wallet.ownerType as 'USER' | 'AGENT',
        ownerId: wallet.ownerId,
      });
      expect(BigInt(projected.available)).toBeGreaterThanOrEqual(0n);
      expect(BigInt(projected.frozen)).toBeGreaterThanOrEqual(0n);
    }
  });

  it('keeps every posted transaction balanced and entries immutable', async () => {
    const posted = await client.ledgerTransaction.findMany({
      where: { status: 'POSTED' },
      include: { entries: true },
    });
    for (const transaction of posted) {
      const debit = transaction.entries
        .filter((entry) => entry.direction === 'DEBIT')
        .reduce((sum, entry) => sum + entry.amount, 0n);
      const credit = transaction.entries
        .filter((entry) => entry.direction === 'CREDIT')
        .reduce((sum, entry) => sum + entry.amount, 0n);
      expect(transaction.entries.length).toBeGreaterThanOrEqual(2);
      expect(debit).toBe(credit);
    }
    const entry = await client.ledgerEntry.findFirstOrThrow();
    await expect(
      client.ledgerEntry.update({
        where: { id: entry.id },
        data: { amount: entry.amount + 1n },
      }),
    ).rejects.toThrow('ledger entries are immutable');
    await expect(
      client.ledgerEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow('ledger entries are immutable');
  });
});
