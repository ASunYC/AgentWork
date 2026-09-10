import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { inspectMigrationReadiness, migrationManifest } from './preflight.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. No database was inspected.');
  process.exitCode = 1;
} else {
  const client = new PrismaClient();
  try {
    const expected = await migrationManifest(
      fileURLToPath(new URL('../prisma/migrations', import.meta.url)),
    );
    const report = await inspectMigrationReadiness(client, expected);
    console.log(JSON.stringify(report, null, 2));
    if (report.blockers.length) process.exitCode = 2;
  } catch {
    console.error(
      'Read-only database inspection failed. Check connectivity, SELECT permissions and migration files; connection details were not logged.',
    );
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}
