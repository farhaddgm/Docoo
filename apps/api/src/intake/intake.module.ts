import { Module } from '@nestjs/common';

import { PatternRuntimeModule } from '../pattern-runtime/pattern-runtime.module.js';
import { IntakeController } from './intake.controller.js';
import { IntakeService } from './intake.service.js';

@Module({
  imports: [PatternRuntimeModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
