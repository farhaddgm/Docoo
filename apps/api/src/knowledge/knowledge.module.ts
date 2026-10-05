import { Module } from '@nestjs/common';
import { RuleBasedAuditor } from '@docoo/knowledge';

import { ConfigModule } from '../config/config.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KNOWLEDGE_AUDITOR, KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [ConfigModule, SourcesModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, { provide: KNOWLEDGE_AUDITOR, useValue: new RuleBasedAuditor() }],
})
export class KnowledgeModule {}
