import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { OutputRequirementsController } from './output-requirements.controller.js';
import { OutputRequirementsService } from './output-requirements.service.js';

@Module({
  imports: [ConfigModule, ProvidersModule],
  controllers: [OutputRequirementsController],
  providers: [OutputRequirementsService],
})
export class OutputRequirementsModule {}
