import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { SmartChatService } from './smart-chat.service.js';
import { SmartContextBuilder } from './smart-context.service.js';
import { SmartErrorsService } from './smart-errors.service.js';
import { SmartExceptionFilter } from './smart-exception.filter.js';
import { SmartFailureReporter } from './smart-failure-reporter.js';
import { SmartIssuesService } from './smart-issues.service.js';
import { SmartController } from './smart.controller.js';
import { WalkerProgressService } from './walker-progress.service.js';

/** Smart (docs/10-smart.md): error tracker, chat, walker progress and the issue ledger. */
@Module({
  imports: [ConfigModule, ProvidersModule],
  controllers: [SmartController],
  providers: [
    SmartErrorsService,
    SmartChatService,
    SmartIssuesService,
    SmartContextBuilder,
    WalkerProgressService,
    SmartFailureReporter,
    { provide: APP_FILTER, useClass: SmartExceptionFilter },
  ],
})
export class SmartModule {}
