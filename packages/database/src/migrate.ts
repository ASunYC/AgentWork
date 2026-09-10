import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { inspectMigrationReadiness, migrationManifest } from './preflight.js';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const schema = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/schema.prisma',
);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const expected = await migrationManifest(
    path.join(path.dirname(schema), 'migrations'),
  );
  const client = new PrismaClient();
  try {
    const before = await inspectMigrationReadiness(client, expected);
    console.log(
      JSON.stringify({ phase: 'before-migration', ...before }, null, 2),
    );
    if (!before.canApplyMigrations) {
      process.exitCode = 2;
      return;
    }
  } finally {
    await client.$disconnect();
  }
  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', schema],
      { stdio: 'inherit', env: process.env },
    );
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  if (result !== 0) {
    process.exitCode = result;
    return;
  }
  const verified = new PrismaClient();
  try {
    const after = await inspectMigrationReadiness(verified, expected);
    console.log(
      JSON.stringify({ phase: 'after-migration', ...after }, null, 2),
    );
    if (!after.readyForV2) process.exitCode = 2;
  } finally {
    await verified.$disconnect();
  }
}

void main().catch(() => {
  console.error(
    'Migration stopped. Check database connectivity, permissions and the preflight report; no automatic settlement or data repair was performed.',
  );
  process.exitCode = 1;
});
