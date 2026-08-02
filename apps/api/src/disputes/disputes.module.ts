import { Module } from '@nestjs/common';
import { ActorAuthGuard } from '../common/actor';
import { HumanAuthGuard } from '../identity/auth';
import { LedgerModule } from '../ledger/ledger.module';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
@Module({
  imports: [LedgerModule],
  controllers: [DisputesController],
  providers: [DisputesService, ActorAuthGuard, HumanAuthGuard],
  exports: [DisputesService],
})
export class DisputesModule {}
