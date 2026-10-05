import { Module } from '@nestjs/common';

import { BusinessModule } from '../business/business.module.js';
import { CommandRunner } from './command-runner.js';
import { WORKFLOW_ENGINE, TemporalWorkflowEngine } from './workflow.engine.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  imports: [BusinessModule],
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    CommandRunner,
    { provide: WORKFLOW_ENGINE, useClass: TemporalWorkflowEngine },
  ],
  exports: [WorkflowService, CommandRunner, WORKFLOW_ENGINE],
})
export class WorkflowModule {}
