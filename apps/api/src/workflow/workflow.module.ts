import { Module } from '@nestjs/common';

import { CommandRunner } from './command-runner.js';
import { WORKFLOW_ENGINE, TemporalWorkflowEngine } from './workflow.engine.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    CommandRunner,
    { provide: WORKFLOW_ENGINE, useClass: TemporalWorkflowEngine },
  ],
  exports: [WorkflowService, CommandRunner],
})
export class WorkflowModule {}
