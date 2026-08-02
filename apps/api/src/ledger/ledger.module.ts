import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [LedgerController],
  providers: [PrismaService, LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
