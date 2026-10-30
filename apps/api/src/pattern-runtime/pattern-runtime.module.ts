import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { PatternRuntimeService } from './pattern-runtime.service.js';
@Module({
  imports: [ConfigModule, ProvidersModule],
  providers: [PatternRuntimeService],
  exports: [PatternRuntimeService],
})
export class PatternRuntimeModule {}
