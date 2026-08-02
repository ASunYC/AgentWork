import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database';
import { LedgerModule } from '../ledger/ledger.module';
import { HumanAuthGuard } from './auth';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [DatabaseModule, LedgerModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    HumanAuthGuard,
  ],
  exports: [HumanAuthGuard],
})
export class IdentityModule {}
