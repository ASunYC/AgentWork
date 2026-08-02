import { Global, Module } from '@nestjs/common';
import { SignupGrantPort } from '../common/signup-grant.port';
import { LedgerController } from './ledger.controller';
import { LEDGER_PORT } from './ledger.port';
import { LedgerService } from './ledger.service';

@Global()
@Module({
  controllers: [LedgerController],
  providers: [
    LedgerService,
    { provide: LEDGER_PORT, useExisting: LedgerService },
    { provide: SignupGrantPort, useExisting: LedgerService },
  ],
  exports: [LedgerService, LEDGER_PORT, SignupGrantPort],
})
export class LedgerModule {}
