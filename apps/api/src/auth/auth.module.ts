import { Global, Module } from '@nestjs/common';

import { WorkspacePermissionGuard } from './auth.authorization.js';
import { AuthController, MeController } from './auth.controller.js';
import { resetDeliveryProvider } from './auth.reset-delivery.js';
import { AccountsService } from './accounts.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import {
  AccountsController,
  GoogleAccessController,
  ResourceAccessController,
} from './accounts.controller.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [
    AuthController,
    MeController,
    AccountsController,
    GoogleAccessController,
    ResourceAccessController,
  ],
  providers: [
    AuthService,
    WorkspacePermissionGuard,
    AccountsService,
    GoogleOAuthService,
    resetDeliveryProvider,
  ],
  exports: [AuthService, WorkspacePermissionGuard],
})
export class AuthModule {}
