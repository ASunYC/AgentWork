import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@agentwork/database';
@Global()
@Module({ providers: [PrismaClient], exports: [PrismaClient] })
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
