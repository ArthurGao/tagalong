import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../../src/app.setup.js';
import { ClerkAdminApi, ClerkVerifier } from '../../../src/modules/auth/clerk.js';
import { StripeClient } from '../../../src/modules/stripe/stripe-client.js';
import { FakeClerkAdminApi, FakeClerkVerifier } from './clerk-fakes.js';
import { FakeStripeClient } from './stripe-fake.js';

export interface TestApp {
  app: INestApplication;
  clerk: FakeClerkAdminApi;
  stripe: FakeStripeClient;
}

// The real AppModule with Clerk and Stripe swapped for fakes: tests never call either.
export async function createTestApp(extraControllers: Type[] = []): Promise<TestApp> {
  const clerk = new FakeClerkAdminApi();
  const stripe = new FakeStripeClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: extraControllers })
    .overrideProvider(ClerkVerifier)
    .useValue(new FakeClerkVerifier())
    .overrideProvider(ClerkAdminApi)
    .useValue(clerk)
    .overrideProvider(StripeClient)
    .useValue(stripe)
    .compile();
  const app = configureApp(moduleRef.createNestApplication(APP_OPTIONS));
  await app.init();
  return { app, clerk, stripe };
}
