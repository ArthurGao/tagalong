import '../load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { AdminRoleService } from '../modules/auth/admin-role.service.js';

// Usage: pnpm --filter backend admin:grant|admin:revoke <email>
const [action, email] = process.argv.slice(2);
if ((action !== 'grant' && action !== 'revoke') || !email) {
  console.error('Usage: pnpm --filter backend admin:grant <email> | admin:revoke <email>');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
try {
  const { clerkSynced } = await app.get(AdminRoleService)[action](email);
  console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} ADMIN for ${email}`);
  if (!clerkSynced) {
    console.error('Clerk publicMetadata was not updated (audited). Re-run the same command to retry the sync.');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await app.close();
}
