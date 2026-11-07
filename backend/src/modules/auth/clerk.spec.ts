import { verifiedPrimaryMatch } from './clerk.js';

const user = (id: string, primary: string, status: 'verified' | 'unverified' = 'verified', others: string[] = []) => ({
  id,
  primaryEmailAddressId: `${id}_p`,
  emailAddresses: [
    { id: `${id}_p`, emailAddress: primary, verification: { status } },
    ...others.map((e, i) => ({ id: `${id}_o${i}`, emailAddress: e, verification: { status: 'unverified' } })),
  ],
});

describe('verifiedPrimaryMatch (who an admin grant may bind to)', () => {
  it('takes the one user whose verified primary email is the address, in any case', () => {
    expect(verifiedPrimaryMatch([user('u1', 'Ops@TagAlong.test')], 'ops@tagalong.test')).toBe('u1');
  });

  it('refuses a match on a secondary or unverified address, someone else could have added it', () => {
    expect(verifiedPrimaryMatch([user('u1', 'me@example.test', 'verified', ['ops@tagalong.test'])], 'ops@tagalong.test')).toBeNull();
    expect(verifiedPrimaryMatch([user('u1', 'ops@tagalong.test', 'unverified')], 'ops@tagalong.test')).toBeNull();
  });

  it('refuses when more than one user qualifies, or none', () => {
    expect(verifiedPrimaryMatch([user('u1', 'ops@tagalong.test'), user('u2', 'ops@tagalong.test')], 'ops@tagalong.test')).toBeNull();
    expect(verifiedPrimaryMatch([], 'ops@tagalong.test')).toBeNull();
  });
});
