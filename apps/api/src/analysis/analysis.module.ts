import { Module } from '@nestjs/common';

import { WorkflowModule } from '../workflow/workflow.module.js';
import { AnalysisController } from './analysis.controller.js';
import { AnalysisService } from './analysis.service.js';

@Module({
  imports: [WorkflowModule],
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}
