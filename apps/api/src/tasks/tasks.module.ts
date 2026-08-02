import { Module } from '@nestjs/common';
import { LEDGER_PORT, UnconfiguredLedgerPort } from '../ledger/ledger.port';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [
    TasksService,
    { provide: LEDGER_PORT, useClass: UnconfiguredLedgerPort },
  ],
  exports: [TasksService],
})
export class TasksModule {}
