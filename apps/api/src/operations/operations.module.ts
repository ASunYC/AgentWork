import { Module } from '@nestjs/common';
import { HumanAuthGuard } from '../identity/auth';
import { LedgerModule } from '../ledger/ledger.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [LedgerModule],
  controllers: [OperationsController],
  providers: [OperationsService, HumanAuthGuard],
})
export class OperationsModule {}
