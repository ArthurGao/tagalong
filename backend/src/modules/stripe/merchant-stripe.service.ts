import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Merchant } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import { StripeClient } from './stripe-client.js';

@Injectable()
export class MerchantStripeService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly stripe: StripeClient,
  ) {}

  /** DESIGN §8.1: create the connected account once, then hand out a fresh onboarding link. */
  async onboard(user: AuthUser): Promise<string> {
    const merchant = await this.merchants.getOwn(user.id);
    if (merchant.status === 'SUSPENDED') throw new AppError('MERCHANT_SUSPENDED', 'This merchant is suspended');
    const accountId = merchant.stripeAccountId ?? (await this.createAccount(merchant));
    return this.stripe.createOnboardingLink(
      accountId,
      `${this.env.APP_URL}/dashboard/onboarding?expired=1`,
      `${this.env.APP_URL}/dashboard/onboarding/return`,
    );
  }

  /** The merchant with its live Stripe state (the return page should not wait for account.updated). */
  async syncOwn(user: AuthUser): Promise<Merchant> {
    const merchant = await this.merchants.getOwn(user.id);
    if (!merchant.stripeAccountId) return merchant;
    return (await this.syncAccount(merchant.stripeAccountId)) ?? merchant;
  }

  /**
   * Copies the live Stripe account state onto its merchant (status and account.updated). Returns null,
   * without calling Stripe, for an account no merchant owns; writes only when a flag changed.
   *
   * Serialised per account across instances (transaction-scoped advisory lock held over the Stripe
   * read and the write): otherwise a slow request holding an older read could overwrite a newer one.
   */
  async syncAccount(accountId: string): Promise<Merchant | null> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-account:${accountId}`}, 0))`;
        const merchant = await tx.merchant.findUnique({ where: { stripeAccountId: accountId } });
        if (!merchant) return null;
        const live = await this.stripe.retrieveAccount(accountId);
        const changed = (Object.keys(live) as (keyof typeof live)[]).some((k) => live[k] !== merchant[k]);
        return changed ? tx.merchant.update({ where: { id: merchant.id }, data: live }) : merchant;
      },
      { maxWait: 15_000, timeout: 30_000 }, // covers waiting behind one other sync plus a slow Stripe call
    );
  }

  private async createAccount(merchant: Merchant): Promise<string> {
    const created = await this.stripe.createConnectedAccount(merchant.id, merchant.contactEmail);
    // Conditional: a concurrent onboarding may have stored an id first (the idempotency key makes
    // Stripe return the same account anyway); keep whatever is stored.
    const { count } = await this.prisma.merchant.updateMany({
      where: { id: merchant.id, stripeAccountId: null },
      data: { stripeAccountId: created },
    });
    if (count === 1) return created;
    const stored = await this.prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
    return stored.stripeAccountId!;
  }
}
