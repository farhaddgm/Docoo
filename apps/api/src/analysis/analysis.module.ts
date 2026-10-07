import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { AnalysisController } from './analysis.controller.js';
import { AnalysisService } from './analysis.service.js';
import { QuestionQualityService } from './question-quality.service.js';

@Module({
  imports: [WorkflowModule, ConfigModule, ProvidersModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, QuestionQualityService],
})
export class AnalysisModule {}
