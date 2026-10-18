import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DeliverablesController } from './deliverables.controller.js';
import { DeliverablesService } from './deliverables.service.js';

@Module({
  imports: [WorkflowModule, ConfigModule, ProvidersModule],
  controllers: [DeliverablesController],
  providers: [DeliverablesService],
})
export class DeliverablesModule {}
