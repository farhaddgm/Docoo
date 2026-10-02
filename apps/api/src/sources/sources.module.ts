import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { dispatcherProvider, objectStoreProvider } from './ingestion.providers.js';
import { SourcesController } from './sources.controller.js';
import { SourcesService } from './sources.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [SourcesController],
  providers: [SourcesService, objectStoreProvider, dispatcherProvider],
  exports: [SourcesService],
})
export class SourcesModule {}
