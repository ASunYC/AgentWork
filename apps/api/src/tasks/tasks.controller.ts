import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  bidSchema,
  createTaskSchema,
  progressSchema,
  selectBidSchema,
  taskListQuerySchema,
  updateTaskSchema,
  versionCommandSchema,
} from '@agentwork/contracts';
import {
  ActorAuthGuard,
  CurrentActor,
  type ActorContext,
} from '../common/actor';
import { ZodPipe } from '../common/zod.pipe';
import { TasksService } from './tasks.service';

@Controller('v1/tasks')
@UseGuards(ActorAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Post() create(
    @CurrentActor() a: ActorContext,
    @Body(new ZodPipe(createTaskSchema)) b: unknown,
  ) {
    return this.tasks.create(a, b as Parameters<TasksService['create']>[1]);
  }
  @Get() list(
    @CurrentActor() a: ActorContext,
    @Query(new ZodPipe(taskListQuerySchema)) q: unknown,
  ) {
    return this.tasks.list(a, q as Parameters<TasksService['list']>[1]);
  }
  @Get(':id') get(@CurrentActor() a: ActorContext, @Param('id') id: string) {
    return this.tasks.get(a, id);
  }
  @Patch(':id') update(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(updateTaskSchema)) b: unknown,
  ) {
    return this.tasks.update(a, id, b as Parameters<TasksService['update']>[2]);
  }
  @Post(':id/publish') publish(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(versionCommandSchema)) b: unknown,
  ) {
    return this.tasks.publish(a, id, b as { version: number });
  }
  @Post(':id/cancel') cancel(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(versionCommandSchema)) b: unknown,
  ) {
    return this.tasks.cancel(a, id, b as { version: number });
  }
  @Post(':id/claim') claim(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(versionCommandSchema)) b: unknown,
  ) {
    return this.tasks.claim(a, id, b as { version: number });
  }
  @Post(':id/bids') bid(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(bidSchema)) b: unknown,
  ) {
    return this.tasks.bid(a, id, b as Parameters<TasksService['bid']>[2]);
  }
  @Get(':id/bids') bids(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
  ) {
    return this.tasks.bids(a, id);
  }
  @Post(':id/select-bid') select(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(selectBidSchema)) b: unknown,
  ) {
    return this.tasks.selectBid(
      a,
      id,
      b as Parameters<TasksService['selectBid']>[2],
    );
  }
  @Post(':id/start') start(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(versionCommandSchema)) b: unknown,
  ) {
    return this.tasks.transitionAgent(
      a,
      id,
      (b as { version: number }).version,
      'start',
    );
  }
  @Post(':id/release') release(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(versionCommandSchema)) b: unknown,
  ) {
    return this.tasks.transitionAgent(
      a,
      id,
      (b as { version: number }).version,
      'release',
    );
  }
  @Post(':id/progress') progress(
    @CurrentActor() a: ActorContext,
    @Param('id') id: string,
    @Body(new ZodPipe(progressSchema)) b: unknown,
  ) {
    const v = b as { version: number; message: string; percent?: number };
    return this.tasks.transitionAgent(a, id, v.version, 'progress', {
      message: v.message,
      percent: v.percent ?? null,
    });
  }
}
