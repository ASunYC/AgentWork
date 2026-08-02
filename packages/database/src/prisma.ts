import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  agentWorkPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.agentWorkPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.agentWorkPrisma = prisma;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
