import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { BrainActionsService } from './brain-actions.service.js';
import { BrainNarrativeService } from './brain-narrative.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { RoleEvaluationService } from './role-evaluation.service.js';

@Module({
  imports: [ConfigModule, ProvidersModule, KnowledgeModule, ProjectsModule, WorkflowModule],
  controllers: [ReportsController],
  providers: [ReportsService, RoleEvaluationService, BrainNarrativeService, BrainActionsService],
})
export class ReportsModule {}
