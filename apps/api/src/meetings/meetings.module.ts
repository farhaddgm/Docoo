import { Module } from '@nestjs/common';
import { PatternRuntimeModule } from '../pattern-runtime/pattern-runtime.module.js';
import { MeetingsService } from './meetings.service.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingProvider } from './meeting.provider.js';
@Module({
  imports: [PatternRuntimeModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingProvider],
})
export class MeetingsModule {}
