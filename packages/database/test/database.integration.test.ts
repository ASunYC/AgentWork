import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

let container: StartedPostgreSqlContainer;
let client: PrismaClient;
let databaseUrl: string;

async function runPrisma(...arguments_: string[]): Promise<void> {
  await execFileAsync(process.execPath, [prismaCli, ...arguments_], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PATH: `${fileURLToPath(new URL('../node_modules/.bin', import.meta.url))}${delimiter}${process.env.PATH ?? ''}`,
    },
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('agentwork_test')
    .withUsername('agentwork')
    .withPassword('agentwork_test')
    .start();
  databaseUrl = container.getConnectionUri();
  await runPrisma('migrate', 'deploy');
  client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
});

afterAll(async () => {
  await client?.$disconnect();
  await container?.stop();
});

describe('database foundation', () => {
  it('applies the schema and seeds system accounts idempotently', async () => {
    await runPrisma('db', 'seed');
    await runPrisma('db', 'seed');

    expect(
      await client.wallet.count({ where: { ownerType: 'PLATFORM' } }),
    ).toBe(1);
    expect(
      await client.ledgerAccount.count({
        where: { type: { in: ['GRANT_POOL', 'ESCROW', 'FEE', 'ADJUSTMENT'] } },
      }),
    ).toBe(4);
  });

  it('stores coin values as bigint and rejects duplicate idempotency keys', async () => {
    const referenceId = crypto.randomUUID();
    const amountBeyondInt32 = 5_000_000_000n;
    const transaction = await client.ledgerTransaction.create({
      data: {
        type: 'ADMIN_ADJUSTMENT',
        referenceType: 'integration_test',
        referenceId,
        idempotencyKey: `test:${referenceId}`,
      },
    });

    await expect(
      client.ledgerTransaction.create({
        data: {
          type: 'ADMIN_ADJUSTMENT',
          referenceType: 'integration_test',
          referenceId: crypto.randomUUID(),
          idempotencyKey: transaction.idempotencyKey,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const wallet = await client.wallet.findFirstOrThrow({
      where: { ownerType: 'PLATFORM' },
    });
    const account = await client.ledgerAccount.findFirstOrThrow({
      where: { walletId: wallet.id },
    });
    const entry = await client.ledgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: account.id,
        direction: 'DEBIT',
        amount: amountBeyondInt32,
      },
    });
    expect(entry.amount).toBe(amountBeyondInt32);
    await expect(
      client.ledgerEntry.update({
        where: { id: entry.id },
        data: { amount: 1n },
      }),
    ).rejects.toThrow('ledger entries are immutable');
  });

  it('enforces one active assignment, bid, and delivery version', async () => {
    const user = await client.user.create({
      data: {
        email: `${crypto.randomUUID()}@example.test`,
        passwordHash: 'not-a-real-password-hash',
        status: 'ACTIVE',
      },
    });
    const agent = await client.agent.create({
      data: {
        ownerUserId: user.id,
        slug: crypto.randomUUID(),
        name: 'Test Agent',
        manifestVersion: '1',
      },
    });
    const secondAgent = await client.agent.create({
      data: {
        ownerUserId: user.id,
        slug: crypto.randomUUID(),
        name: 'Second Agent',
        manifestVersion: '1',
      },
    });
    const task = await client.task.create({
      data: {
        publisherId: user.id,
        title: 'Constraint test',
        objective: 'Verify database constraints',
        mode: 'BID',
        budget: 1000n,
      },
    });

    await client.bid.create({
      data: {
        taskId: task.id,
        agentId: agent.id,
        amount: 900n,
        proposal: 'First',
        eta: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      client.bid.create({
        data: {
          taskId: task.id,
          agentId: agent.id,
          amount: 800n,
          proposal: 'Duplicate',
          eta: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await client.taskAssignment.create({
      data: { taskId: task.id, agentId: agent.id },
    });
    await expect(
      client.taskAssignment.create({
        data: { taskId: task.id, agentId: secondAgent.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await client.delivery.create({
      data: {
        taskId: task.id,
        agentId: agent.id,
        version: 1,
        summary: 'First',
      },
    });
    await expect(
      client.delivery.create({
        data: {
          taskId: task.id,
          agentId: agent.id,
          version: 1,
          summary: 'Duplicate',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
