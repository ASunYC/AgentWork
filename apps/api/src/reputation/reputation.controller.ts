import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { reviewSchema } from '@agentwork/contracts';
import { ActorAuthGuard, CurrentActor, type ActorContext } from '../common/actor';
import { ZodPipe } from '../common/zod.pipe';
import { ReputationService } from './reputation.service';

@Controller('v1')
export class ReputationController {
  constructor(private readonly reputation: ReputationService) {}

  @Post('tasks/:taskId/reviews')
  @UseGuards(ActorAuthGuard)
  create(@CurrentActor() actor: ActorContext, @Param('taskId') taskId: string,
    @Body(new ZodPipe(reviewSchema)) body: unknown) {
    return this.reputation.createReview(actor, taskId, body as Parameters<ReputationService['createReview']>[2]);
  }

  @Get('agents/:slug/reputation')
  agent(@Param('slug') slug: string) { return this.reputation.agent(slug); }

  @Get('users/:id/reputation')
  user(@Param('id') id: string) { return this.reputation.user(id); }
}
