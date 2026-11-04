import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectsService } from '../projects/projects.service.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { LIVE_CAPABILITIES, LiveCapabilityRegistry } from './capabilities.js';
import { LiveAssistantController } from './live-assistant.controller.js';
import { LiveAssistantService } from './live-assistant.service.js';
import { projectCapabilities } from './project-capabilities.js';

/** The live voice assistant (ADR-0055): sessions, the confirmation gateway and its ledger. */
@Module({
  imports: [ConfigModule, ProjectsModule, WorkflowModule],
  controllers: [LiveAssistantController],
  providers: [
    LiveAssistantService,
    {
      provide: LIVE_CAPABILITIES,
      inject: [ProjectsService, WorkflowService],
      useFactory: (projects: ProjectsService, workflow: WorkflowService) =>
        new LiveCapabilityRegistry(projectCapabilities({ projects, workflow })),
    },
  ],
})
export class LiveAssistantModule {}
