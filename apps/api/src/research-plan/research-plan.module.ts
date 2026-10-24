import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { ResearchPlanController } from './research-plan.controller.js';
import { ResearchPlanService } from './research-plan.service.js';

@Module({
  imports: [WorkflowModule, ConfigModule, ProvidersModule],
  controllers: [ResearchPlanController],
  providers: [ResearchPlanService],
})
export class ResearchPlanModule {}
