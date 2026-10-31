import { describe, expect, it } from 'vitest';
import { firstParam, isUuid, queryHref } from './query-href';

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

describe('isUuid', () => {
  it('accepts a UUID in any case and nothing else', () => {
    expect([isUuid('01a18fe0-1954-754b-89e8-872f83b0e599'), isUuid('01A18FE0-1954-754B-89E8-872F83B0E599')]).toEqual([true, true]);
    expect([isUuid(undefined), isUuid(''), isUuid('01a18fe0'), isUuid('01a18fe0-1954-754b-89e8-872f83b0e599x')]).toEqual([false, false, false, false]);
  });
});
