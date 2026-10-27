import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import zhCN from '../../messages/zh-CN.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('message catalogs', () => {
  it('zh-CN and en define exactly the same keys', () => {
    expect(keys(zhCN).sort()).toEqual(keys(en).sort());
  });

  it('has no empty strings', () => {
    for (const catalog of [en, zhCN]) {
      const empty = keys(catalog).filter((k) =>
        k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], catalog) === '',
      );
      expect(empty).toEqual([]);
    }
  });
});
