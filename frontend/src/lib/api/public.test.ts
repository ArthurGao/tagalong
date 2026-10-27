import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchParticipants, fetchPublicListing } from './public';

// Network boundary: the typed API client.
const get = vi.fn();
vi.mock('./client', () => ({ api: { GET: (...args: unknown[]) => get(...args) } }));
const reply = (status: number, data?: unknown) => ({ data, response: { status, url: 'http://backend/x' } });

describe('public fetchers', () => {
  afterEach(() => get.mockReset());

  it('return the data on success and null only for 404', async () => {
    get.mockResolvedValueOnce(reply(200, { shortCode: 'abcd2345' }));
    expect(await fetchPublicListing('abcd2345')).toEqual({ shortCode: 'abcd2345' });
    get.mockResolvedValueOnce(reply(404));
    expect(await fetchPublicListing('nope')).toBeNull();
    get.mockResolvedValueOnce(reply(404));
    expect(await fetchParticipants('abcd2345')).toBeNull();
  });

  it('throw on server errors instead of reporting "not found" or an empty sheet', async () => {
    get.mockResolvedValueOnce(reply(500));
    await expect(fetchPublicListing('abcd2345')).rejects.toThrow('500');
    get.mockResolvedValueOnce(reply(503));
    await expect(fetchParticipants('abcd2345', 4)).rejects.toThrow('503');
  });
});
