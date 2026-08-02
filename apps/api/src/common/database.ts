import { Global, Module } from '@nestjs/common';
import { PrismaClient, prisma } from '@agentwork/database';

export const PRISMA = Symbol('PRISMA');

@Global()
@Module({
  providers: [
    { provide: PRISMA, useValue: prisma },
    { provide: PrismaClient, useExisting: PRISMA },
  ],
  exports: [PRISMA, PrismaClient],
})
export class DatabaseModule {}
