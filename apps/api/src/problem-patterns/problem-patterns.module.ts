import { Module } from '@nestjs/common';
import { PatternRuntimeModule } from '../pattern-runtime/pattern-runtime.module.js';
import { ProblemPatternsService } from './problem-patterns.service.js';
import { ProblemPatternsController } from './problem-patterns.controller.js';
import { PatternAiProvider } from './pattern-ai.provider.js';
@Module({
  imports: [PatternRuntimeModule],
  controllers: [ProblemPatternsController],
  providers: [ProblemPatternsService, PatternAiProvider],
})
export class ProblemPatternsModule {}
