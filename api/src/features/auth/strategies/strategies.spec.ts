import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  it('delegates to AuthService.validateUser', async () => {
    const auth = { validateUser: jest.fn(async () => ({ id: 'u1' })) } as any;
    const strategy = new LocalStrategy(auth);
    await strategy.validate('a@b.co', 'pw');
    expect(auth.validateUser).toHaveBeenCalledWith('a@b.co', 'pw');
  });
});

describe('JwtStrategy', () => {
  const config = {
    getOrThrow: () => ({ jwtAccessSecret: 'secret', issuer: 'cybernetics' }),
  } as unknown as ConfigService;

  it('maps a verified payload to a Principal', () => {
    const strategy = new JwtStrategy(config);
    expect(
      strategy.validate({ sub: 'u1', role: 'admin', kind: 'user' }),
    ).toEqual({ id: 'u1', role: 'admin' });
  });
});
