import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  deliverySchema,
  revisionSchema,
  versionCommandSchema,
} from '@agentwork/contracts';
import {
  ActorAuthGuard,
  CurrentActor,
  type ActorContext,
} from '../common/actor';
import { ZodPipe } from '../common/zod.pipe';
import { DeliveriesService } from './deliveries.service';
@Controller('v1/tasks')
@UseGuards(ActorAuthGuard)
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}
  @Post(':id/deliveries') deliver(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(deliverySchema)) b: unknown,
  ) {
    return this.deliveries.deliver(
      a,
      id,
      b as Parameters<DeliveriesService['deliver']>[2],
    );
  }
  @Post(':id/request-revision') revision(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(revisionSchema)) b: unknown,
  ) {
    return this.deliveries.revision(
      a,
      id,
      b as Parameters<DeliveriesService['revision']>[2],
    );
  }
  @Post(':id/accept') accept(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(versionCommandSchema)) b: unknown,
  ) {
    return this.deliveries.accept(a, id, b as { version: number });
  }
}
