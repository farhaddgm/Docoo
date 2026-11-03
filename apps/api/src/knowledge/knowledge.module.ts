import { Module } from '@nestjs/common';
import { RuleBasedAuditor } from '@docoo/knowledge';

import { ConfigModule } from '../config/config.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { ResearchMemoryController } from './research-memory.controller.js';
import { ResearchMemoryService } from './research-memory.service.js';
import { KNOWLEDGE_AUDITOR, KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [ConfigModule, SourcesModule],
  controllers: [KnowledgeController, ResearchMemoryController],
  providers: [
    KnowledgeService,
    ResearchMemoryService,
    { provide: KNOWLEDGE_AUDITOR, useValue: new RuleBasedAuditor() },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
