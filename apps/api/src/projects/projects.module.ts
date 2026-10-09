import { Module } from '@nestjs/common';

import { BusinessModule } from '../business/business.module.js';
import { ConfigModule } from '../config/config.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DecisionIntelligenceController } from './decision-intelligence.controller.js';
import { DecisionIntelligenceService } from './decision-intelligence.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [ConfigModule, BusinessModule, WorkflowModule],
  controllers: [ProjectsController, DecisionIntelligenceController],
  providers: [ProjectsService, DecisionIntelligenceService],
})
export class ProjectsModule {}
