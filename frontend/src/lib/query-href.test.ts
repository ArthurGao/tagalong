import { describe, expect, it } from 'vitest';
import { firstParam, queryHref } from './query-href';

describe('queryHref', () => {
  it('keeps the current filters and applies the changes', () => {
    expect(queryHref('/en/merchants', { status: 'ACTIVE', q: 'kiwi' }, { id: 'm1' })).toBe('/en/merchants?status=ACTIVE&q=kiwi&id=m1');
  });

  it('drops values that are undefined or empty, and the ? when nothing is left', () => {
    expect(queryHref('/en/merchants', { status: 'ACTIVE', id: 'm1' }, { id: undefined })).toBe('/en/merchants?status=ACTIVE');
    expect(queryHref('/en/merchants', { q: '' })).toBe('/en/merchants');
  });

  it('encodes values', () => {
    expect(queryHref('/en/listings', { q: 'a&b c' })).toBe('/en/listings?q=a%26b+c');
  });

  it('reads the first value of a search param', () => {
    expect([firstParam('a'), firstParam(['b', 'c']), firstParam(undefined)]).toEqual(['a', 'b', undefined]);
  });
});
