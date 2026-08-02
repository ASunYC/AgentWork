import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DatabaseModule } from '../common/database';
@Module({ imports: [DatabaseModule], controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
