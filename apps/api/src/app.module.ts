import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { CoreModule } from './core.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SmartModule } from './smart/smart.module.js';
import { SourcesModule } from './sources/sources.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { WorkspaceModule } from './workspaces/workspace.module.js';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    WorkspaceModule,
    TopicsModule,
    ConfigModule,
    ProjectsModule,
    AuditModule,
    SourcesModule,
    KnowledgeModule,
    ProvidersModule,
    WorkflowModule,
    DocumentsModule,
    ReportsModule,
    SmartModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
