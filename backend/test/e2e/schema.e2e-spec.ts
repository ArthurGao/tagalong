import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { resetDb, testPrisma } from './support/db.js';
import { createFreeOrder, createListing, createUser } from './support/factories.js';

describe('database constraints (hand-written migration SQL)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('onePerEmail: a second live registration with the same email in any case is rejected', async () => {
    const listing = await createListing(prisma, { onePerEmail: true });
    await createFreeOrder(prisma, listing, 'Amy@Example.com');
    await expect(createFreeOrder(prisma, listing, 'amy@example.com')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('onePerEmail: a cancelled registration does not block a new one', async () => {
    const listing = await createListing(prisma, { onePerEmail: true });
    const first = await createFreeOrder(prisma, listing, 'amy@example.com');
    await prisma.order.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
    await expect(createFreeOrder(prisma, listing, 'amy@example.com')).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('listings without onePerEmail accept repeat registrations from one email', async () => {
    const listing = await createListing(prisma, { onePerEmail: false });
    await createFreeOrder(prisma, listing, 'amy@example.com');
    await expect(createFreeOrder(prisma, listing, 'amy@example.com')).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('an option can never be sold beyond its capacity', async () => {
    const listing = await createListing(prisma);
    const option = listing.options[0];
    await expect(
      prisma.listingOption.update({ where: { id: option.id }, data: { soldCount: 4, reservedCount: 2 } }),
    ).rejects.toThrow(/listing_option_within_capacity/);
  });

  it('a pickup point used by an order cannot be deleted, even bypassing the service', async () => {
    const listing = await createListing(prisma, { onePerEmail: false });
    const point = await prisma.pickupPoint.create({ data: { listingId: listing.id, label: 'A', address: '1 Main St' } });
    const order = await createFreeOrder(prisma, listing, 'amy@example.test');
    await prisma.order.update({ where: { id: order.id }, data: { pickupPointId: point.id } });
    await expect(prisma.pickupPoint.delete({ where: { id: point.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('audit_log rejects UPDATE and DELETE', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const row = await prisma.auditLog.create({
      data: { actorUserId: admin.id, actorRole: 'ADMIN', action: 'PII_REVEAL', targetType: 'order', targetId: 'o1' },
    });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { reason: 'x' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
