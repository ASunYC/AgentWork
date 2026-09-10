import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';

export type ExpectedMigration = { name: string; checksums: string[] };
export async function migrationManifest(
  directory: string,
): Promise<ExpectedMigration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const sql = await readFile(
          join(directory, entry.name, 'migration.sql'),
          'utf8',
        );
        const lf = sql.replace(/\r\n/g, '\n');
        return {
          name: entry.name,
          checksums: [
            ...new Set(
              [sql, lf, lf.replace(/\n/g, '\r\n')].map((text) =>
                createHash('sha256').update(text).digest('hex'),
              ),
            ),
          ],
        };
      }),
  );
}

export type MigrationPreflight = {
  checkedAt: string;
  mode: 'read-only';
  schema: 'empty' | 'legacy' | 'v2' | 'unrecognized';
  canApplyMigrations: boolean;
  readyForV2: boolean;
  blockers: { code: string; message: string; count?: string }[];
  notes: string[];
  migrations: {
    applied: string[];
    pending: string[];
    modified: string[];
    failed: string[];
    unknown: string[];
  };
  legacy: {
    tasksByStatus: { status: string; count: string }[];
    activeTasks: string;
    openDisputes: string;
    frozenAccounts: string;
    escrowAccounts: string;
    negativeAccounts: string;
    unbalancedTransactions: string;
    pendingTransactions: string;
    agentsWithoutActiveDevices: string;
  } | null;
};

/** Can run with a SELECT-only role and before any V2 migrations. Never settles,
 * cancels, seeds, or rewrites records; all inspection uses one read-only snapshot. */
export async function inspectMigrationReadiness(
  db: PrismaClient,
  expected: ExpectedMigration[],
): Promise<MigrationPreflight> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const tables = new Set(
        (
          await tx.$queryRaw<
            { table_name: string }[]
          >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
        ).map((row) => row.table_name),
      );
      const report: MigrationPreflight = {
        checkedAt: new Date().toISOString(),
        mode: 'read-only',
        schema: 'empty',
        canApplyMigrations: false,
        readyForV2: false,
        blockers: [],
        notes: [],
        migrations: {
          applied: [],
          pending: expected.map((item) => item.name),
          modified: [],
          failed: [],
          unknown: [],
        },
        legacy: null,
      };
      if (tables.has('_prisma_migrations')) {
        const history = await tx.$queryRaw<
          {
            migration_name: string;
            checksum: string;
            finished_at: Date | null;
            rolled_back_at: Date | null;
          }[]
        >`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`;
        const finished = history.filter(
          (row) => row.finished_at && !row.rolled_back_at,
        );
        report.migrations.applied = finished.map((row) => row.migration_name);
        report.migrations.pending = expected
          .filter(
            (item) => !finished.some((row) => row.migration_name === item.name),
          )
          .map((item) => item.name);
        report.migrations.failed = history
          .filter((row) => !row.finished_at && !row.rolled_back_at)
          .map((row) => row.migration_name);
        report.migrations.unknown = finished
          .filter(
            (row) => !expected.some((item) => item.name === row.migration_name),
          )
          .map((row) => row.migration_name);
        report.migrations.modified = finished
          .filter((row) => {
            const item = expected.find(
              (item) => item.name === row.migration_name,
            );
            return item && !item.checksums.includes(row.checksum);
          })
          .map((row) => row.migration_name);
      }
      for (const [field, code] of [
        ['failed', 'FAILED_MIGRATION'],
        ['modified', 'MIGRATION_DRIFT'],
        ['unknown', 'DATABASE_AHEAD_OF_CHECKOUT'],
      ] as const) {
        if (report.migrations[field].length)
          report.blockers.push({
            code,
            message: report.migrations[field].join(', '),
          });
      }
      if (!expected.length)
        report.blockers.push({
          code: 'MIGRATION_MANIFEST_MISSING',
          message: 'No local migration manifest was supplied',
        });
      const businessTables = [...tables].filter(
        (table) => table !== '_prisma_migrations',
      );
      const required = [
        'users',
        'agents',
        'tasks',
        'disputes',
        'ledger_accounts',
        'ledger_transactions',
        'ledger_entries',
      ];
      if (
        businessTables.length &&
        required.some((table) => !tables.has(table))
      ) {
        report.schema = 'unrecognized';
        report.blockers.push({
          code: 'UNRECOGNIZED_SCHEMA',
          message:
            'Database does not contain a complete AgentWork legacy schema; no changes should be applied automatically',
        });
        return report;
      }
      if (!businessTables.length) {
        if (report.migrations.applied.length)
          report.blockers.push({
            code: 'SCHEMA_DRIFT',
            message:
              'Migration history exists but application tables are missing',
          });
        report.canApplyMigrations = !report.blockers.length;
        return report;
      }
      report.schema = tables.has('projects') ? 'v2' : 'legacy';
      const tasksByStatus = await tx.$queryRaw<
        { status: string; count: string }[]
      >`SELECT status::text AS status, COUNT(*)::text AS count FROM tasks GROUP BY status ORDER BY status`;
      const terminal = new Set([
        'DRAFT',
        'COMPLETED_SETTLED',
        'CANCELLED_REFUNDED',
        'EXPIRED_REFUNDED',
        'PARTIALLY_SETTLED',
      ]);
      const activeTasks = tasksByStatus
        .filter((row) => !terminal.has(row.status))
        .reduce((sum, row) => sum + BigInt(row.count), 0n)
        .toString();
      const disputes = await tx.$queryRaw<
        { count: string }[]
      >`SELECT COUNT(*)::text AS count FROM disputes WHERE status::text IN ('OPEN','INVESTIGATING')`;
      const balances = await tx.$queryRaw<
        { type: string; nonzero: string; negative: string }[]
      >`
      SELECT type, COUNT(*) FILTER (WHERE balance <> 0)::text AS nonzero, COUNT(*) FILTER (WHERE balance < 0)::text AS negative FROM (
        SELECT a.id, a.type::text AS type, COALESCE(SUM(CASE WHEN t.status::text = 'POSTED' THEN CASE WHEN e.direction::text = 'CREDIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0) AS balance
        FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id LEFT JOIN ledger_transactions t ON t.id = e.transaction_id
        WHERE a.type::text IN ('AVAILABLE','FROZEN','ESCROW') GROUP BY a.id, a.type
      ) b GROUP BY type`;
      const unbalanced = await tx.$queryRaw<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM (
        SELECT t.id FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id = t.id WHERE t.status::text = 'POSTED'
        GROUP BY t.id HAVING COUNT(e.id) < 2 OR COALESCE(SUM(CASE WHEN e.direction::text = 'CREDIT' THEN e.amount ELSE -e.amount END),0) <> 0 OR MIN(e.amount) <= 0
      ) invalid`;
      const pending = await tx.$queryRaw<
        { count: string }[]
      >`SELECT COUNT(*)::text AS count FROM ledger_transactions WHERE status::text = 'PENDING'`;
      const enrollment = tables.has('agent_installations')
        ? await tx.$queryRaw<
            { count: string }[]
          >`SELECT COUNT(*)::text AS count FROM agents a WHERE a.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_installations i WHERE i."agentId" = a.id AND i."revokedAt" IS NULL)`
        : await tx.$queryRaw<
            { count: string }[]
          >`SELECT COUNT(*)::text AS count FROM agents WHERE owner_user_id IS NOT NULL`;
      report.legacy = {
        tasksByStatus,
        activeTasks,
        openDisputes: disputes[0]!.count,
        frozenAccounts:
          balances.find((row) => row.type === 'FROZEN')?.nonzero ?? '0',
        escrowAccounts:
          balances.find((row) => row.type === 'ESCROW')?.nonzero ?? '0',
        negativeAccounts: balances
          .reduce((sum, row) => sum + BigInt(row.negative), 0n)
          .toString(),
        unbalancedTransactions: unbalanced[0]!.count,
        pendingTransactions: pending[0]!.count,
        agentsWithoutActiveDevices: enrollment[0]!.count,
      };
      for (const [field, code, message] of [
        [
          'activeTasks',
          'ACTIVE_LEGACY_TASKS',
          'Finish or explicitly resolve legacy tasks before disabling their write workflow',
        ],
        [
          'openDisputes',
          'OPEN_LEGACY_DISPUTES',
          'Resolve outstanding legacy disputes through the existing domain workflow',
        ],
        [
          'frozenAccounts',
          'FROZEN_COINS',
          'Frozen coin balances require reconciliation before cutover',
        ],
        [
          'escrowAccounts',
          'ESCROW_COINS',
          'Escrow balances require reconciliation before cutover',
        ],
        [
          'negativeAccounts',
          'NEGATIVE_LEDGER_BALANCE',
          'Protected ledger accounts contain negative balances',
        ],
        [
          'unbalancedTransactions',
          'UNBALANCED_LEDGER',
          'Posted transactions violate the ledger balance contract',
        ],
        [
          'pendingTransactions',
          'PENDING_LEDGER_TRANSACTIONS',
          'Pending ledger transactions need inspection',
        ],
      ] as const) {
        if (BigInt(report.legacy[field]) !== 0n)
          report.blockers.push({ code, message, count: report.legacy[field] });
      }
      if (BigInt(report.legacy.agentsWithoutActiveDevices))
        report.notes.push(
          'Legacy Agent identities are preserved. Active devices can be migrated using a scoped legacy key; already migrated identities may require recovery. Usernames alone do not establish ownership.',
        );
      if (tasksByStatus.some((row) => row.status === 'DRAFT'))
        report.notes.push(
          'Legacy drafts remain as history and are not converted into Git projects.',
        );
      report.canApplyMigrations = !report.blockers.length;
      if (!report.migrations.pending.length) {
        const columns = await tx.$queryRaw<
          { table_name: string; column_name: string; is_nullable: string }[]
        >`SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public'`;
        const mismatches: string[] = [];
        for (const model of Prisma.dmmf.datamodel.models) {
          const table = model.dbName ?? model.name;
          for (const field of model.fields.filter(
            (field) => field.kind !== 'object',
          )) {
            const name = field.dbName ?? field.name;
            const column = columns.find(
              (column) =>
                column.table_name === table && column.column_name === name,
            );
            if (
              !column ||
              (!field.isList &&
                (column.is_nullable === 'NO') !== field.isRequired)
            )
              mismatches.push(`${table}.${name}`);
          }
        }
        if (mismatches.length)
          report.blockers.push({
            code: 'SCHEMA_DRIFT',
            message: `Missing columns or unexpected nullability: ${mismatches.join(', ')}`,
          });
        report.canApplyMigrations = !report.blockers.length;
      }
      report.readyForV2 =
        report.canApplyMigrations &&
        !report.migrations.pending.length &&
        [
          'projects',
          'agent_installations',
          'agent_recovery_keys',
          'project_events',
          'project_notifications',
        ].every((table) => tables.has(table));
      return report;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}
