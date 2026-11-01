import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';

/** Voice conversation (ADR-0046): speech to text and text to speech around the text chat. */
@Module({
  imports: [ConfigModule, ProvidersModule, SourcesModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
