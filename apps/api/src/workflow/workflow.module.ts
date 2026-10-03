import { Module } from '@nestjs/common';

import { WORKFLOW_ENGINE, TemporalWorkflowEngine } from './workflow.engine.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, { provide: WORKFLOW_ENGINE, useClass: TemporalWorkflowEngine }],
  exports: [WorkflowService],
})
export class WorkflowModule {}
