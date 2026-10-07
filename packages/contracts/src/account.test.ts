import { describe, it, expect } from 'vitest';
import { normalizeGmail, isGmail, accountInputSchema } from './account.js';
describe('account identity and sign-in constraints', () => {
  it.each(['First.Last@gmail.com', 'firstlast+docoo@gmail.com', ' first.last+tag@GOOGLEMAIL.COM '])(
    'normalizes Gmail aliases consistently: %s',
    (email) => {
      expect(normalizeGmail(email)).toBe('firstlast@gmail.com');
      expect(isGmail(email)).toBe(true);
    },
  );
  it('keeps non-Gmail addresses distinct', () => {
    expect(normalizeGmail('First.Last+tag@Example.com')).toBe('first.last+tag@example.com');
    expect(isGmail('gmail.com@attacker.invalid')).toBe(false);
  });
  it.each(['GOOGLE', 'BOTH'])('accepts Google methods only for Gmail: %s', (method) => {
    expect(
      accountInputSchema.safeParse({
        email: 'person@example.com',
        displayName: 'Person',
        role: 'editor',
        loginMethod: method,
        workspaceIds: ['11111111-1111-4111-8111-111111111111'],
      }).success,
    ).toBe(false);
  });
  it('rejects passwords on Google-only accounts', () => {
    expect(
      accountInputSchema.safeParse({
        email: 'person@gmail.com',
        displayName: 'Person',
        role: 'editor',
        loginMethod: 'GOOGLE',
        password: 'password123',
        workspaceIds: ['11111111-1111-4111-8111-111111111111'],
      }).success,
    ).toBe(false);
  });
});
