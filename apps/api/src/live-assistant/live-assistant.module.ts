import { Module } from '@nestjs/common';

import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { ConfigModule } from '../config/config.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { ProjectReportService } from '../projects/project-report.service.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectsService } from '../projects/projects.service.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { LIVE_CAPABILITIES, LiveCapabilityRegistry } from './capabilities.js';
import { LiveAssistantController } from './live-assistant.controller.js';
import { LiveAssistantService } from './live-assistant.service.js';
import { knowledgeCapabilities } from './knowledge-capabilities.js';
import { projectCapabilities } from './project-capabilities.js';

/** The live voice assistant (ADR-0055): sessions, the confirmation gateway and its ledger. */
@Module({
  imports: [
    ConfigModule,
    KnowledgeModule,
    NotificationsModule,
    ProjectsModule,
    ProvidersModule,
    WorkflowModule,
  ],
  controllers: [LiveAssistantController],
  providers: [
    LiveAssistantService,
    {
      provide: LIVE_CAPABILITIES,
      inject: [
        ProjectsService,
        ProjectReportService,
        NotificationsService,
        WorkflowService,
        KnowledgeService,
      ],
      useFactory: (
        projects: ProjectsService,
        reports: ProjectReportService,
        notifications: NotificationsService,
        workflow: WorkflowService,
        knowledge: KnowledgeService,
      ) =>
        new LiveCapabilityRegistry([
          ...projectCapabilities({ projects, reports, notifications, workflow }),
          ...knowledgeCapabilities({ knowledge }),
        ]),
    },
  ],
})
export class LiveAssistantModule {}
