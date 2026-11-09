import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { MonitorController } from './monitor.controller.js';
import { MonitorService } from './monitor.service.js';

/** The monitors (ADR-0056): read-only room screens for the owner. */
@Module({
  imports: [ConfigModule],
  controllers: [MonitorController],
  providers: [MonitorService],
})
export class MonitorModule {}
