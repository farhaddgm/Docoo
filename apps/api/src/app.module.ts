import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CoreModule } from './core.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { TopicsModule } from './topics/topics.module.js';
import { WorkspaceModule } from './workspaces/workspace.module.js';

@Module({
  imports: [CoreModule, AuthModule, WorkspaceModule, TopicsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
