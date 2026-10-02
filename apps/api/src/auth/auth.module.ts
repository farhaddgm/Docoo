import { Global, Module } from '@nestjs/common';

import { WorkspacePermissionGuard } from './auth.authorization.js';
import { AuthController, MeController } from './auth.controller.js';
import { OperatorResetDelivery, PASSWORD_RESET_DELIVERY } from './auth.reset-delivery.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    WorkspacePermissionGuard,
    { provide: PASSWORD_RESET_DELIVERY, useClass: OperatorResetDelivery },
  ],
  exports: [AuthService, WorkspacePermissionGuard],
})
export class AuthModule {}
