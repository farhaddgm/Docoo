import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { StageChatController } from './stage-chat.controller.js';
import { StageChatService } from './stage-chat.service.js';

@Module({
  imports: [WorkflowModule, ConfigModule, ProvidersModule],
  controllers: [StageChatController],
  providers: [StageChatService],
})
export class StageChatModule {}
