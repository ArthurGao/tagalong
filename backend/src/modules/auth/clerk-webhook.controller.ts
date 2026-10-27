import { Controller, HttpCode, Inject, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Webhook } from 'svix';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AdminSignInService } from './admin-sign-in.service.js';
import { UserSyncService } from './user-sync.service.js';

interface ClerkUserData {
  id: string;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string }[];
}

// Only the events we subscribe to; anything else falls through the switch untouched.
type ClerkEvent =
  | { type: 'user.created' | 'user.updated'; data: ClerkUserData }
  | { type: 'user.deleted'; data: { id: string } }
  | { type: 'session.created'; data: { id: string; user_id: string } };

@ApiExcludeController()
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  private readonly webhook: Webhook | null;

  constructor(
    @Inject(ENV) env: Env,
    private readonly users: UserSyncService,
    private readonly adminSignIns: AdminSignInService,
  ) {
    // No secret configured (local dev before Clerk exists): every delivery is rejected.
    this.webhook = env.CLERK_WEBHOOK_SIGNING_SECRET ? new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET) : null;
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const event = this.verify(req);
    switch (event.type) {
      case 'user.created':
      case 'user.updated': {
        const { id, email_addresses, primary_email_address_id } = event.data;
        const email = email_addresses.find((e) => e.id === primary_email_address_id)?.email_address;
        if (email) await this.users.upsertFromClerk(id, email);
        break;
      }
      case 'user.deleted':
        await this.users.softDelete(event.data.id);
        break;
      case 'session.created':
        await this.adminSignIns.record(event.data.id, event.data.user_id);
        break;
    }
    return { received: true };
  }

  // Svix signature over the raw body; replays are absorbed by idempotent handlers.
  // svix 2.x verify() only checks the signature (returns undefined), so the body is parsed here.
  private verify(req: RawBodyRequest<Request>): ClerkEvent {
    const body = req.rawBody?.toString('utf8') ?? '';
    try {
      if (!this.webhook) throw new Error('no signing secret');
      this.webhook.verify(body, {
        'svix-id': String(req.headers['svix-id']),
        'svix-timestamp': String(req.headers['svix-timestamp']),
        'svix-signature': String(req.headers['svix-signature']),
      });
    } catch {
      throw new AppError('BAD_REQUEST', 'Invalid webhook signature');
    }
    return JSON.parse(body) as ClerkEvent;
  }
}
