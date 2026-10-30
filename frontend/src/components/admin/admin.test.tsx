// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@/lib/api/schema';
import { messages, renderWithIntl } from '@/test/render';
import { AdminNav } from './AdminNav';
import { appEnv, EnvBanner } from './EnvBanner';
import { ListingDetail } from './ListingDetail';
import { MerchantDetail } from './MerchantDetail';
import { RiskFlags } from './RiskFlags';

// Network boundary: the typed API client. Navigation: the Next router.
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { POST: (...a: unknown[]) => post(...a) } }));
const refresh = vi.fn();
let pathname = '/en/merchants';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => pathname }));

type Merchant = components['schemas']['AdminMerchantDto'];
type Listing = components['schemas']['AdminListingDto'];
const t = messages.admin;

const merchant = (over: Partial<Merchant> = {}): Merchant => ({
  id: 'm1',
  slug: 'kiwi-fruit',
  displayName: 'Kiwi Fruit',
  contactEmail: 'shop@example.test',
  status: 'ACTIVE',
  chargesEnabled: true,
  riskFlags: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  description: null,
  contactPhone: '021 000 000',
  gstNumber: null,
  suspendedReason: null,
  suspendedAt: null,
  ownerDeleted: false,
  stripeAccountId: 'acct_1',
  payoutsEnabled: true,
  detailsSubmitted: true,
  figures: { paidCents90d: 10_000, refundedCents90d: 0, openDisputes: 0, todayCents: 0, previous30dCents: 3_000 },
  orderCount: 3,
  disputeCount: 0,
  listings: [],
  notes: [],
  ...over,
});

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'l1',
  shortCode: 'abcd2345',
  title: 'Cherries',
  status: 'PUBLISHED',
  pricing: 'PAID',
  soldCount: 2,
  takenDown: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  closesAt: null,
  merchant: { id: 'm1', slug: 'kiwi-fruit', displayName: 'Kiwi Fruit', status: 'ACTIVE' },
  description: '',
  takenDownReason: null,
  takenDownAt: null,
  options: [{ name: '2kg', priceCents: 3900, capacity: 10, soldCount: 2, reservedCount: 0, active: true }],
  orderCounts: [{ status: 'PAID', count: 2 }],
  cancellation: null,
  canClose: true,
  canTakedown: true,
  canRestore: false,
  ...over,
});

afterEach(() => {
  cleanup();
  post.mockReset();
  refresh.mockReset();
});

describe('EnvBanner', () => {
  it('names the environment, red in production and amber on staging', () => {
    renderWithIntl(<EnvBanner env="production" />);
    const banner = screen.getByRole('note');
    expect(banner.textContent).toBe(t.env.production);
    expect(banner.className).toContain('bg-destructive');
    cleanup();
    renderWithIntl(<EnvBanner env="staging" />);
    expect(screen.getByRole('note').className).toContain('bg-warning');
  });

  it('treats anything but production or staging as local development', () => {
    expect([appEnv('production'), appEnv('staging'), appEnv(undefined), appEnv('prod')]).toEqual(['production', 'staging', 'development', 'development']);
  });
});

describe('AdminNav', () => {
  it('marks the current section', () => {
    pathname = '/en/merchants';
    renderWithIntl(<AdminNav />);
    expect(screen.getByRole('link', { current: 'page' }).textContent).toBe(t.nav.merchants);
    expect(screen.getByRole('link', { name: t.nav.overview }).getAttribute('href')).toBe('/en');
  });
});

describe('RiskFlags', () => {
  it('labels each flag, and renders nothing without flags', () => {
    renderWithIntl(<RiskFlags flags={['NEW_MERCHANT', 'OPEN_DISPUTE']} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([`⚠ ${t.risk.NEW_MERCHANT}`, `⚠ ${t.risk.OPEN_DISPUTE}`]);
    cleanup();
    const { container } = renderWithIntl(<RiskFlags flags={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('MerchantDetail', () => {
  it('suspends only with a reason and the typed slug, then refreshes the page', async () => {
    post.mockResolvedValue({ data: merchant({ status: 'SUSPENDED' }) });
    renderWithIntl(<MerchantDetail merchant={merchant()} />);
    fireEvent.click(screen.getByRole('button', { name: t.merchants.suspend }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: t.confirm.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(t.confirm.reason), { target: { value: '  Fake goods  ' } });
    expect(confirm.disabled).toBe(true); // slug not typed yet
    fireEvent.change(within(dialog).getByLabelText(t.confirm.typeToConfirm.replace('{text}', 'kiwi-fruit')), { target: { value: 'kiwi-frui' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(t.confirm.typeToConfirm.replace('{text}', 'kiwi-fruit')), { target: { value: 'kiwi-fruit' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/admin/merchants/{id}/suspend', { params: { path: { id: 'm1' } }, body: { reason: 'Fake goods' } });
  });

  it('keeps the dialog open with the error when the write is refused', async () => {
    post.mockResolvedValue({ error: { code: 'INVALID_STATE_TRANSITION' } });
    renderWithIntl(<MerchantDetail merchant={merchant({ status: 'SUSPENDED', suspendedReason: 'Spam', suspendedAt: '2026-10-02T00:00:00.000Z' })} />);
    fireEvent.click(screen.getByRole('button', { name: t.merchants.reinstate }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t.confirm.reason), { target: { value: 'Cleared' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirm.confirm }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(messages.errors.INVALID_STATE_TRANSITION);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers no reinstatement when the owner deleted their account', () => {
    renderWithIntl(<MerchantDetail merchant={merchant({ status: 'SUSPENDED', ownerDeleted: true })} />);
    expect(screen.queryByRole('button', { name: t.merchants.reinstate })).toBeNull();
    expect(screen.getByText(t.merchants.ownerDeleted)).toBeTruthy();
  });

  it('adds a note', async () => {
    post.mockResolvedValue({ data: { id: 'n1', note: 'Called', authorEmail: 'ops@x', createdAt: '2026-10-02T00:00:00.000Z' } });
    renderWithIntl(<MerchantDetail merchant={merchant()} />);
    fireEvent.change(screen.getByLabelText(t.merchants.addNote), { target: { value: 'Called the owner' } });
    fireEvent.click(screen.getByRole('button', { name: t.merchants.addNote }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/v1/admin/merchants/{id}/notes', { params: { path: { id: 'm1' } }, body: { note: 'Called the owner' } });
  });
});

describe('ListingDetail', () => {
  const takedown = async (l: Listing, refundAll: boolean) => {
    post.mockResolvedValue({ data: l });
    renderWithIntl(<ListingDetail listing={l} />);
    fireEvent.click(screen.getByRole('button', { name: t.listings.takedown }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t.confirm.reason), { target: { value: 'Counterfeit' } });
    fireEvent.change(within(dialog).getByLabelText(t.confirm.typeToConfirm.replace('{text}', 'kiwi-fruit')), { target: { value: 'kiwi-fruit' } });
    if (refundAll) fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: t.confirm.confirm }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    return dialog;
  };

  it('takes down with or without refunds, as chosen', async () => {
    await takedown(listing(), true);
    expect(post).toHaveBeenCalledWith('/api/v1/admin/listings/{id}/takedown', { params: { path: { id: 'l1' } }, body: { reason: 'Counterfeit', refundAll: true } });
    cleanup();
    post.mockReset();
    await takedown(listing(), false);
    expect(post).toHaveBeenCalledWith('/api/v1/admin/listings/{id}/takedown', { params: { path: { id: 'l1' } }, body: { reason: 'Counterfeit', refundAll: false } });
  });

  it('words the "everyone" choice for paid and free listings', () => {
    renderWithIntl(<ListingDetail listing={listing({ pricing: 'FREE' })} />);
    fireEvent.click(screen.getByRole('button', { name: t.listings.takedown }));
    expect(within(screen.getByRole('dialog')).getByLabelText(t.listings.refundAllFree)).toBeTruthy();
  });

  it('shows only the actions the listing allows', () => {
    renderWithIntl(<ListingDetail listing={listing({ status: 'CANCELLED', takenDown: true, canClose: false, canTakedown: false, canRestore: true, takenDownReason: 'Fake', takenDownAt: '2026-10-02T00:00:00.000Z' })} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t.listings.restore]);
    expect(screen.getByText(/Fake/).className).toContain('text-destructive');
  });
});
