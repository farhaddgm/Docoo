import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { SolutionsService } from './solutions.service.js';

@Module({
  imports: [ConfigModule, ProvidersModule, SourcesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, SolutionsService],
})
export class DocumentsModule {}
