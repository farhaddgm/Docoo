import { Module } from '@nestjs/common';

import { BusinessModule } from '../business/business.module.js';
import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { SolutionsService } from './solutions.service.js';
import { WritingsService } from './writings.service.js';

@Module({
  imports: [ConfigModule, BusinessModule, ProvidersModule, SourcesModule, WorkflowModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, SolutionsService, WritingsService],
})
export class DocumentsModule {}
