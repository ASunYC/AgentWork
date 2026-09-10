import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  inspectMigrationReadiness,
  migrationManifest,
  type ExpectedMigration,
} from '../src/preflight.js';
import { ProjectEventEngine } from '../src/project-events.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const migrations = fileURLToPath(
  new URL('../prisma/migrations', import.meta.url),
);
const guardedMigration = fileURLToPath(
  new URL('../src/migrate.ts', import.meta.url),
);
let container: StartedPostgreSqlContainer;
let db: PrismaClient;
let directory: string;
let url: string;
let expected: ExpectedMigration[];
const snapshot = async () =>
  JSON.stringify(
    await Promise.all([
      db.user.findMany({ orderBy: { id: 'asc' } }),
      db.agent.findMany({ orderBy: { id: 'asc' } }),
      db.task.findMany({ orderBy: { id: 'asc' } }),
      db.ledgerEntry.findMany({ orderBy: { id: 'asc' } }),
      db.ledgerTransaction.findMany({ orderBy: { id: 'asc' } }),
    ]),
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
  );
async function deploy() {
  await run(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      join(directory, 'schema.prisma'),
    ],
    { env: { ...process.env, DATABASE_URL: url }, windowsHide: true },
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  url = container.getConnectionUri();
  db = new PrismaClient({ datasources: { db: { url } } });
  directory = await mkdtemp(join(tmpdir(), 'agentwork-upgrade-'));
  await cp(
    join(dirname(migrations), 'schema.prisma'),
    join(directory, 'schema.prisma'),
  );
  await mkdir(join(directory, 'migrations'));
  await cp(
    join(migrations, 'migration_lock.toml'),
    join(directory, 'migrations', 'migration_lock.toml'),
  );
  expected = await migrationManifest(migrations);
});
afterAll(async () => {
  await db?.$disconnect();
  await container?.stop();
  if (
    directory &&
    resolve(directory).startsWith(resolve(tmpdir(), 'agentwork-upgrade-'))
  )
    await rm(directory, { recursive: true, force: true });
});

describe.sequential('V1 to V2 upgrade rehearsal', () => {
  it('inspects V1 without writing, refuses active/frozen work, and preserves legacy records across all V2 migrations', async () => {
    const empty = await inspectMigrationReadiness(db, expected);
    expect(empty.schema).toBe('empty');
    expect(empty.canApplyMigrations).toBe(true);
    expect(empty.readyForV2).toBe(false);
    for (const item of expected.filter((item) =>
      item.name.startsWith('202608'),
    ))
      await cp(
        join(migrations, item.name),
        join(directory, 'migrations', item.name),
        { recursive: true },
      );
    await deploy();
    const user = await db.user.create({
      data: {
        email: 'legacy-private@example.test',
        passwordHash: 'legacy-password-hash',
        status: 'ACTIVE',
      },
    });
    const agent = await db.agent.create({
      data: {
        ownerUserId: user.id,
        slug: 'legacy-agent',
        name: 'Legacy Agent',
        status: 'ACTIVE',
        manifestVersion: '1',
      },
    });
    const task = await db.task.create({
      data: {
        publisherId: user.id,
        title: 'Historical request',
        objective: 'Preserve history',
        mode: 'CLAIM',
        budget: 40n,
        status: 'OPEN',
      },
    });
    await db.task.create({
      data: {
        publisherId: user.id,
        title: 'Historical draft',
        objective: 'Keep as history',
        mode: 'CLAIM',
        budget: 10n,
        status: 'DRAFT',
      },
    });
    const wallet = await db.wallet.create({
      data: {
        ownerType: 'USER',
        ownerId: user.id,
        accounts: { create: [{ type: 'AVAILABLE' }, { type: 'FROZEN' }] },
      },
      include: { accounts: true },
    });
    const system = await db.wallet.create({
      data: {
        ownerType: 'PLATFORM',
        ownerId: randomUUID(),
        accounts: { create: { type: 'GRANT_POOL' } },
      },
      include: { accounts: true },
    });
    const available = wallet.accounts.find(
      (account) => account.type === 'AVAILABLE',
    )!.id;
    const frozen = wallet.accounts.find(
      (account) => account.type === 'FROZEN',
    )!.id;
    const post = async (
      type: 'SIGNUP_GRANT' | 'TASK_FREEZE' | 'FULL_REFUND',
      from: string,
      to: string,
      amount: bigint,
    ) =>
      db.$transaction(async (tx) => {
        const transaction = await tx.ledgerTransaction.create({
          data: {
            type,
            referenceType: 'upgrade-fixture',
            referenceId: task.id,
            idempotencyKey: randomUUID(),
            entries: {
              create: [
                { accountId: from, direction: 'DEBIT', amount },
                { accountId: to, direction: 'CREDIT', amount },
              ],
            },
          },
        });
        await tx.ledgerTransaction.update({
          where: { id: transaction.id },
          data: { status: 'POSTED', postedAt: new Date() },
        });
      });
    await post('SIGNUP_GRANT', system.accounts[0]!.id, available, 100n);
    await post('TASK_FREEZE', available, frozen, 40n);
    const beforeInspection = await snapshot();
    const blocked = await inspectMigrationReadiness(db, expected);
    expect(blocked.schema).toBe('legacy');
    expect(blocked.canApplyMigrations).toBe(false);
    expect(blocked.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining(['ACTIVE_LEGACY_TASKS', 'FROZEN_COINS']),
    );
    expect(blocked.legacy?.agentsWithoutActiveDevices).toBe('1');
    expect(JSON.stringify(blocked)).not.toContain(user.email);
    expect(JSON.stringify(blocked)).not.toContain(user.passwordHash);
    expect(await snapshot()).toBe(beforeInspection);
    await expect(
      run(process.execPath, [require.resolve('tsx/cli'), guardedMigration], {
        env: { ...process.env, DATABASE_URL: url },
        windowsHide: true,
      }),
    ).rejects.toMatchObject({ code: 2 });
    expect(await snapshot()).toBe(beforeInspection);
    // Fixture-only settlement; the preflight and migration tools never perform this operation.
    await post('FULL_REFUND', frozen, available, 40n);
    await db.task.update({
      where: { id: task.id },
      data: { status: 'CANCELLED_REFUNDED' },
    });
    expect(
      (await inspectMigrationReadiness(db, expected)).canApplyMigrations,
    ).toBe(true);
    const legacyFingerprint = await snapshot();
    const firstV2 = expected.find((item) =>
      item.name.endsWith('project_collaboration'),
    )!;
    await cp(
      join(migrations, firstV2.name),
      join(directory, 'migrations', firstV2.name),
      { recursive: true },
    );
    await deploy();
    const projectId = randomUUID();
    const eventId = randomUUID();
    await db.$executeRaw`INSERT INTO projects (id, slug, name, description, categories, "gitUrl", "ownerAgentId", version, "updatedAt") VALUES (${projectId}::uuid, 'early-project', 'Early project', 'Preserve original owner', ARRAY['DEVELOPMENT'], 'https://example.com/repo.git', ${agent.id}::uuid, 7, NOW())`;
    await db.projectMember.create({
      data: { projectId, agentId: agent.id, role: 'OWNER' },
    });
    await db.$executeRaw`INSERT INTO project_events (id, "projectId", "actorAgentId", type, "resourceId", payload) VALUES (${eventId}::uuid, ${projectId}::uuid, ${agent.id}::uuid, 'project.created', ${projectId}::uuid, '{}'::jsonb)`;
    for (const item of expected.filter(
      (item) => !item.name.startsWith('202608') && item.name !== firstV2.name,
    ))
      await cp(
        join(migrations, item.name),
        join(directory, 'migrations', item.name),
        { recursive: true },
      );
    await deploy();
    expect(await snapshot()).toBe(legacyFingerprint);
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(project.creatorAgentId).toBe(agent.id);
    expect(project.eventBaselineVersion).toBe(7);
    const historical = await db.projectEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(historical.version).toBeNull();
    expect(historical.deliveryStatus).toBe('LEGACY');
    expect(await new ProjectEventEngine(db).runBatch()).toEqual({
      delivered: 0,
      failed: 0,
    });
    const ready = await inspectMigrationReadiness(db, expected);
    expect(ready.blockers).toEqual([]);
    expect(ready.readyForV2).toBe(true);
    const repeated = await run(
      process.execPath,
      [require.resolve('tsx/cli'), guardedMigration],
      { env: { ...process.env, DATABASE_URL: url }, windowsHide: true },
    );
    expect(repeated.stdout).toContain('after-migration');
    expect(await snapshot()).toBe(legacyFingerprint);
    const entry = await db.ledgerEntry.findFirstOrThrow();
    await expect(
      db.ledgerEntry.update({ where: { id: entry.id }, data: { amount: 1n } }),
    ).rejects.toThrow();
    expect(await snapshot()).toBe(legacyFingerprint);
  }, 120000);

  it('runs under a SELECT-only database role', async () => {
    await db.$executeRawUnsafe(
      "CREATE ROLE agentwork_audit LOGIN PASSWORD 'isolated_audit_test_password'",
    );
    await db.$executeRawUnsafe(
      'GRANT USAGE ON SCHEMA public TO agentwork_audit',
    );
    await db.$executeRawUnsafe(
      'GRANT SELECT ON ALL TABLES IN SCHEMA public TO agentwork_audit',
    );
    const readOnlyUrl = new URL(url);
    readOnlyUrl.username = 'agentwork_audit';
    readOnlyUrl.password = 'isolated_audit_test_password';
    const reader = new PrismaClient({
      datasources: { db: { url: readOnlyUrl.toString() } },
    });
    try {
      expect(
        (await inspectMigrationReadiness(reader, expected)).readyForV2,
      ).toBe(true);
    } finally {
      await reader.$disconnect();
    }
  });

  it('detects checksum drift and structural drift instead of declaring the database ready', async () => {
    const first = expected[0]!;
    const rows = await db.$queryRaw<
      { checksum: string }[]
    >`SELECT checksum FROM _prisma_migrations WHERE migration_name = ${first.name}`;
    await db.$executeRaw`UPDATE _prisma_migrations SET checksum = 'changed' WHERE migration_name = ${first.name}`;
    expect(
      (await inspectMigrationReadiness(db, expected)).blockers.some(
        (item) => item.code === 'MIGRATION_DRIFT',
      ),
    ).toBe(true);
    await db.$executeRaw`UPDATE _prisma_migrations SET checksum = ${rows[0]!.checksum} WHERE migration_name = ${first.name}`;
    await db.$executeRawUnsafe(
      'ALTER TABLE agents ALTER COLUMN owner_user_id SET NOT NULL',
    );
    expect(
      (await inspectMigrationReadiness(db, expected)).blockers.some(
        (item) => item.code === 'SCHEMA_DRIFT',
      ),
    ).toBe(true);
    await db.$executeRawUnsafe(
      'ALTER TABLE agents ALTER COLUMN owner_user_id DROP NOT NULL',
    );
    expect((await inspectMigrationReadiness(db, expected)).readyForV2).toBe(
      true,
    );
  });
});
