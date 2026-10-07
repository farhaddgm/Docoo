import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { NotificationMailer, notificationTransportProvider } from './notification-mailer.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationMailer, notificationTransportProvider],
  exports: [NotificationMailer],
})
export class NotificationsModule {}
