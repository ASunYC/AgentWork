import { Module } from '@nestjs/common';
import { prisma } from '@agentwork/database';

export const PRISMA = Symbol('PRISMA');

@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class DatabaseModule {}
