import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  disputeEvidenceSchema,
  disputeSchema,
  resolveDisputeSchema,
} from '@agentwork/contracts';
import {
  ActorAuthGuard,
  CurrentActor,
  type ActorContext,
} from '../common/actor';
import { ZodPipe } from '../common/zod.pipe';
import { AuthenticatedRequest, HumanAuthGuard, Roles } from '../identity/auth';
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
  @Post('disputes/:disputeId/evidence')
  evidence(
    @CurrentActor() actor: ActorContext,
    @Param('disputeId') disputeId: string,
    @Body(new ZodPipe(disputeEvidenceSchema)) body: unknown,
  ) {
    return this.disputes.addEvidence(
      actor,
      disputeId,
      body as Parameters<DisputesService['addEvidence']>[2],
    );
  }

  @Post('disputes/:disputeId/resolve')
  @UseGuards(HumanAuthGuard)
  @Roles('ADMIN')
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('disputeId') disputeId: string,
    @Body(new ZodPipe(resolveDisputeSchema)) body: unknown,
  ) {
    return this.disputes.resolve(
      req.user!.id,
      req.header('x-request-id') ?? crypto.randomUUID(),
      disputeId,
      body as Parameters<DisputesService['resolve']>[3],
    );
  }
}
