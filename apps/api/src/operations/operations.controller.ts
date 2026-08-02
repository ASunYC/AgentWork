import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  adminAdjustmentSchema,
  contentReportSchema,
  moderationDecisionSchema,
} from '@agentwork/contracts';
import type { Request } from 'express';
import {
  ActorAuthGuard,
  CurrentActor,
  type ActorContext,
} from '../common/actor';
import { ZodPipe } from '../common/zod.pipe';
import { AuthenticatedRequest, HumanAuthGuard, Roles } from '../identity/auth';
import { OperationsService } from './operations.service';

@Controller('v1')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post('reports')
  @UseGuards(ActorAuthGuard)
  report(
    @CurrentActor() actor: ActorContext,
    @Req() req: Request,
    @Body(new ZodPipe(contentReportSchema)) body: unknown,
  ) {
    return this.operations.report(
      actor,
      req.ip,
      body as Parameters<OperationsService['report']>[2],
    );
  }

  @Post('admin/reports/:id/decision')
  @UseGuards(HumanAuthGuard)
  @Roles('ADMIN')
  decide(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(moderationDecisionSchema)) body: unknown,
  ) {
    return this.operations.decide(
      req.user!.id,
      req.header('x-request-id') ?? crypto.randomUUID(),
      id,
      body as Parameters<OperationsService['decide']>[3],
    );
  }

  @Post('admin/ledger/adjustments')
  @UseGuards(HumanAuthGuard)
  @Roles('ADMIN')
  adjust(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(adminAdjustmentSchema)) body: unknown,
  ) {
    return this.operations.adjust(
      req.user!.id,
      req.header('x-request-id') ?? crypto.randomUUID(),
      body as Parameters<OperationsService['adjust']>[2],
    );
  }

  @Get('admin/:resource')
  @UseGuards(HumanAuthGuard)
  @Roles('ADMIN')
  list(
    @Param('resource') resource: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.operations.list(resource, cursor, limit ? Number(limit) : 20);
  }
}
