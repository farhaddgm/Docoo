import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { CoreModule } from './core.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { ProjectsModule } from './projects/projects.module.js';
import { TopicsModule } from './topics/topics.module.js';
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
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
