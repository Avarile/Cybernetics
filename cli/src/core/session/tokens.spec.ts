import { EXPIRY_SKEW_MS, isExpired, pairFromLogin } from './tokens';

const pair = (expiresAt: number) => ({
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt,
});

describe('isExpired', () => {
  const now = 1_000_000;

  it('is false for a token well inside its lifetime', () => {
    expect(isExpired(pair(now + 10 * 60_000), now)).toBe(false);
  });

  it('is true for a token past its expiry', () => {
    expect(isExpired(pair(now - 1), now)).toBe(true);
  });

  it('is true inside the skew window, so a token cannot expire in flight', () => {
    expect(isExpired(pair(now + EXPIRY_SKEW_MS - 1), now)).toBe(true);
  });

  it('is false just outside the skew window', () => {
    expect(isExpired(pair(now + EXPIRY_SKEW_MS + 1), now)).toBe(false);
  });
});

describe('pairFromLogin', () => {
  it('converts the API expiresIn (seconds) to an absolute ms timestamp', () => {
    const now = 1_000_000;
    expect(
      pairFromLogin(
        { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
        now,
      ),
    ).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: now + 900_000 });
  });
});
