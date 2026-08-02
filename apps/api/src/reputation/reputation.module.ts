import { Module } from '@nestjs/common';
import { ActorAuthGuard } from '../common/actor';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

@Module({
  controllers: [ReputationController],
  providers: [ReputationService, ActorAuthGuard],
})
export class ReputationModule {}
