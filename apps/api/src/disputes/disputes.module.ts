import { Module } from '@nestjs/common';
import { ActorAuthGuard } from '../common/actor';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
@Module({
  controllers: [DisputesController],
  providers: [DisputesService, ActorAuthGuard],
  exports: [DisputesService],
})
export class DisputesModule {}
