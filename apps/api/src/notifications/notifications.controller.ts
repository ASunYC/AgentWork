import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentActor, type ActorContext } from '../common/actor';
import { NotificationsService } from './notifications.service';
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() list(
    @CurrentActor() actor: ActorContext,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    if (actor.type !== 'USER')
      throw new UnauthorizedException('User authentication required');
    return this.notifications.list(actor.id, cursor, Number(limit ?? 20));
  }
  @Post(':id/read') read(
    @CurrentActor() actor: ActorContext,
    @Param('id') id: string,
  ) {
    if (actor.type !== 'USER')
      throw new UnauthorizedException('User authentication required');
    return this.notifications.read(actor.id, id);
  }
}
