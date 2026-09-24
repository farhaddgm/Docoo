import { Global, Module } from '@nestjs/common';

import { WorkspacePermissionGuard } from './auth.authorization.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, WorkspacePermissionGuard],
  exports: [AuthService, WorkspacePermissionGuard],
})
export class AuthModule {}
