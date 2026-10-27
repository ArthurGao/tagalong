import { maskName } from './mask.js';

describe('maskName (DESIGN §10)', () => {
  it.each([
    ['Arthur Gao', 'Arthur G.'],
    ['  arthur   gao  ', 'arthur G.'],
    ['Mary Ann Lee', 'Mary L.'],
    ['Lily', 'Lily'],
    ['高阳', '高*'],
    ['欧阳娜娜', '欧***'],
    ['阳', '阳'],
    ['', '*'],
    ['   ', '*'],
  ])('%j → %j', (input, masked) => {
    expect(maskName(input)).toBe(masked);
  });

  it.each([
    ['ArthurGao', 'Arthur G.'],
    ['arthur.gao', 'arthur G.'],
    ['arthur_gao', 'arthur G.'],
    ['高 阳', '高*'],
    [' 欧阳 娜娜 ', '欧***'],
    ['Gao 阳', 'G***'],
    ['arthur@example.com', '*'],
    ['021 555 1234', '*'],
    ['+64215551234', '*'],
    ['Lily 2', 'Lily'],
  ])('fails closed on unusual input: %j → %j', (input, masked) => {
    expect(maskName(input)).toBe(masked);
  });

  it('never returns the full surname of a two-word name', () => {
    expect(maskName('Wei Zhang')).not.toContain('Zhang');
  });
});
