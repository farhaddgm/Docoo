import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { RoleEvaluationService } from './role-evaluation.service.js';

@Module({
  imports: [ConfigModule, ProvidersModule],
  controllers: [ReportsController],
  providers: [ReportsService, RoleEvaluationService],
})
export class ReportsModule {}
