import { Global, Module } from '@nestjs/common';

import { WorkspacePermissionGuard } from './auth.authorization.js';
import { AuthController, MeController } from './auth.controller.js';
import { resetDeliveryProvider } from './auth.reset-delivery.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, WorkspacePermissionGuard, resetDeliveryProvider],
  exports: [AuthService, WorkspacePermissionGuard],
})
export class AuthModule {}
