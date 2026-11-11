import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { MonitorController } from './monitor.controller.js';
import {
  MonitorShareAdminController,
  MonitorSharePublicController,
} from './monitor-share.controller.js';
import { MonitorShareService } from './monitor-share.service.js';
import { MonitorService } from './monitor.service.js';

/** The monitors (ADR-0056): read-only room screens for the owner. */
@Module({
  imports: [ConfigModule],
  controllers: [MonitorController, MonitorShareAdminController, MonitorSharePublicController],
  providers: [MonitorService, MonitorShareService],
})
export class MonitorModule {}
