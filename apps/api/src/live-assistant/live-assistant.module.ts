import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import {
  LIVE_CAPABILITIES,
  LiveCapabilityRegistry,
  liveCapabilityDefinitions,
} from './capabilities.js';
import { LiveAssistantController } from './live-assistant.controller.js';
import { LiveAssistantService } from './live-assistant.service.js';

/** The live voice assistant (ADR-0055): sessions, the confirmation gateway and its ledger. */
@Module({
  imports: [ConfigModule],
  controllers: [LiveAssistantController],
  providers: [
    LiveAssistantService,
    {
      provide: LIVE_CAPABILITIES,
      useFactory: () => new LiveCapabilityRegistry(liveCapabilityDefinitions),
    },
  ],
})
export class LiveAssistantModule {}
