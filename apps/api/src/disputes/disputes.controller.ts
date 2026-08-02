import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { disputeSchema } from '@agentwork/contracts';
import {
  ActorAuthGuard,
  CurrentActor,
  type ActorContext,
} from '../common/actor';
import { ZodPipe } from '../common/zod.pipe';
import { DisputesService } from './disputes.service';
@Controller('v1/tasks')
@UseGuards(ActorAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}
  @Post(':id/disputes') open(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(disputeSchema)) b: unknown,
  ) {
    return this.disputes.open(
      a,
      id,
      b as Parameters<DisputesService['open']>[2],
    );
  }
}
