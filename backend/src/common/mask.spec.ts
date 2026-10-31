import { maskEmail, maskName, maskPhone } from './mask.js';

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

describe('maskEmail / maskPhone (admin order search, DESIGN §9)', () => {
  it.each([
    ['amy.lee@example.com', 'a***@example.com'],
    ['A@b.co', 'A***@b.co'],
    ['高阳@example.cn', '高***@example.cn'],
    ['@example.com', '***'],
    ['not-an-email', '***'],
  ])('email %j → %j', (input, masked) => {
    expect(maskEmail(input)).toBe(masked);
  });

  it.each([
    ['021 555 0101', '*** 0101'],
    ['+64 21 555 0101', '*** 0101'],
    ['5550101', '*** 0101'],
    ['555 010', '***'],
    ['', '***'],
  ])('phone %j → %j', (input, masked) => {
    expect(maskPhone(input)).toBe(masked);
  });
});
