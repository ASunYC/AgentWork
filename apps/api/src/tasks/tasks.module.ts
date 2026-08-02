import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ActorAuthGuard } from '../common/actor';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [LedgerModule],
  controllers: [TasksController],
  providers: [TasksService, ActorAuthGuard],
  exports: [TasksService],
})
export class TasksModule {}
