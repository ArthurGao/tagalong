import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminRoleService } from './admin-role.service.js';
import { AdminSignInService } from './admin-sign-in.service.js';
import { ClerkAdminApi, ClerkSdkAdminApi, ClerkSdkVerifier, ClerkVerifier } from './clerk.js';
import { ClerkAuthGuard } from './clerk-auth.guard.js';
import { ClerkWebhookController } from './clerk-webhook.controller.js';
import { MeController } from './me.controller.js';
import { RolesGuard } from './roles.guard.js';
import { UserSyncService } from './user-sync.service.js';

// Global so @Auth() works on controllers in any module.
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [MeController, ClerkWebhookController],
  providers: [
    { provide: ClerkVerifier, useClass: ClerkSdkVerifier },
    { provide: ClerkAdminApi, useClass: ClerkSdkAdminApi },
    UserSyncService,
    AdminSignInService,
    AdminRoleService,
    ClerkAuthGuard,
    RolesGuard,
  ],
  // Guards instantiated in other modules need these; ClerkAdminApi stays private to auth.
  exports: [ClerkVerifier, UserSyncService, ClerkAuthGuard, RolesGuard],
})
export class AuthModule {}
