import type { PrismaClient } from '@prisma/client';

export async function resetTestDatabase(client: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetTestDatabase may only run with NODE_ENV=test');
  }

  const tables = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const quotedTables = tables
    .map(
      ({ table_name: tableName }) =>
        `"public"."${tableName.replaceAll('"', '""')}"`,
    )
    .join(', ');

  await client.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} CASCADE`);
}
