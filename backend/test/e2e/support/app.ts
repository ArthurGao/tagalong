import type { INestApplication, Type } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../../src/app.setup.js';
import { ClerkAdminApi, ClerkVerifier } from '../../../src/modules/auth/clerk.js';
import { TurnstileVerifier } from '../../../src/common/security/turnstile.js';
import { EmailService } from '../../../src/modules/notifications/email.service.js';
import { StripeClient } from '../../../src/modules/stripe/stripe-client.js';
import { ObjectStorage } from '../../../src/modules/uploads/object-storage.js';
import { FakeClerkAdminApi, FakeClerkVerifier } from './clerk-fakes.js';
import { FakeEmailService } from './email-fake.js';
import { FakeTurnstileVerifier } from './turnstile-fake.js';
import { FakeObjectStorage } from './storage-fake.js';
import { FakeStripeClient } from './stripe-fake.js';

export interface TestApp {
  app: INestApplication;
  clerk: FakeClerkAdminApi;
  stripe: FakeStripeClient;
  storage: FakeObjectStorage;
  email: FakeEmailService;
  turnstile: FakeTurnstileVerifier;
}

// The real AppModule with Clerk, Stripe, object storage, email and Turnstile swapped for fakes: tests never call them.
export async function createTestApp(extraControllers: Type[] = []): Promise<TestApp> {
  const clerk = new FakeClerkAdminApi();
  const stripe = new FakeStripeClient();
  const storage = new FakeObjectStorage();
  const email = new FakeEmailService();
  const turnstile = new FakeTurnstileVerifier();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: extraControllers })
    .overrideProvider(ClerkVerifier)
    .useValue(new FakeClerkVerifier())
    .overrideProvider(ClerkAdminApi)
    .useValue(clerk)
    .overrideProvider(StripeClient)
    .useValue(stripe)
    .overrideProvider(ObjectStorage)
    .useValue(storage)
    .overrideProvider(EmailService)
    .useValue(email)
    .overrideProvider(TurnstileVerifier)
    .useValue(turnstile)
    .compile();
  const app = configureApp(moduleRef.createNestApplication(APP_OPTIONS));
  await app.init();
  // Jobs run only when a test calls them; a ticking cron would race tests on the shared database.
  for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  return { app, clerk, stripe, storage, email, turnstile };
}
