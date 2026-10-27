import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

const short = () => randomUUID().replace(/-/g, '').slice(0, 8);

export async function createUser(prisma: PrismaClient, data: { role?: 'MERCHANT' | 'ADMIN'; email?: string } = {}) {
  const id = short();
  return prisma.user.create({
    data: { email: data.email ?? `u-${id}@example.test`, clerkUserId: `user_${id}`, role: data.role ?? 'MERCHANT' },
  });
}

export async function createMerchant(prisma: PrismaClient) {
  const owner = await createUser(prisma);
  return prisma.merchant.create({
    data: {
      ownerUserId: owner.id,
      slug: `m-${short()}`,
      displayName: 'Test merchant',
      contactEmail: owner.email,
      contactPhone: '021000000',
    },
  });
}

export async function createListing(
  prisma: PrismaClient,
  data: { pricing?: 'FREE' | 'PAID'; onePerEmail?: boolean } = {},
) {
  const merchant = await createMerchant(prisma);
  return prisma.listing.create({
    data: {
      merchantId: merchant.id,
      shortCode: short(),
      title: 'Test listing',
      description: 'Test',
      type: 'EVENT',
      fulfilment: 'ONSITE',
      pricing: data.pricing ?? 'FREE',
      maxQtyPerOrder: 1,
      onePerEmail: data.onePerEmail ?? true,
      allowSelfCancel: true,
      policyText: 'No refunds',
      options: { create: [{ name: 'Seat', priceCents: 0, capacity: 5 }] },
    },
    include: { options: true },
  });
}

export async function createFreeOrder(
  prisma: PrismaClient,
  listing: { id: string; merchantId: string; onePerEmail: boolean },
  buyerEmail: string,
) {
  return prisma.order.create({
    data: {
      publicCode: `TA-${short().toUpperCase()}`,
      accessToken: randomUUID(),
      listingId: listing.id,
      merchantId: listing.merchantId,
      buyerName: 'Buyer',
      buyerEmail,
      buyerPhone: '021111111',
      isFree: true,
      onePerEmail: listing.onePerEmail,
      status: 'CONFIRMED',
      subtotalCents: 0,
      platformFeeCents: 0,
      totalCents: 0,
    },
  });
}
