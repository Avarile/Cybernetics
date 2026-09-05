import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { UsersService } from './users.service';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'u1',
    email: 'a@b.co',
    passwordHash: 'HASH',
    role: 'user',
    displayName: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    lastLoginAt: null,
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('UsersService', () => {
  let repo: any;
  let passwords: any;
  let revocation: any;
  let service: UsersService;

  beforeEach(() => {
    repo = {
      findByEmail: jest.fn(async () => null),
      findActiveById: jest.fn(async () => makeRow()),
      create: jest.fn(async (v: any) => makeRow(v)),
      update: jest.fn(async (id: string, patch: any) =>
        makeRow({ id, ...patch }),
      ),
      softDelete: jest.fn(async () => undefined),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
    };
    passwords = { hash: jest.fn(async () => 'HASH') };
    revocation = { revokeAllForUser: jest.fn(async () => undefined) };
    service = new UsersService(
      repo,
      passwords,
      revocation,
      new ExceptionService(),
    );
  });

  it('creates a user: lowercases email, hashes password, strips the hash', async () => {
    const user = await service.create({
      email: 'MixedCase@B.co',
      password: 'a-very-strong-pass',
      role: 'user',
    });
    expect(passwords.hash).toHaveBeenCalledWith('a-very-strong-pass');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'mixedcase@b.co',
        passwordHash: 'HASH',
      }),
    );
    expect((user as any).passwordHash).toBeUndefined();
    expect(user.email).toBe('mixedcase@b.co');
  });

  it('rejects a duplicate email', async () => {
    repo.findByEmail.mockResolvedValueOnce(makeRow());
    await expect(
      service.create({
        email: 'a@b.co',
        password: 'a-very-strong-pass',
        role: 'user',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_EMAIL_TAKEN });
  });

  it('404s when updating a missing user', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(
      service.update('nope', { role: 'admin' }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND });
  });

  it('soft-deletes an existing user', async () => {
    await service.remove('u1');
    expect(repo.softDelete).toHaveBeenCalledWith('u1');
  });

  describe('UsersService revocation triggers', () => {
    // Before this, neither of these paths revoked anything at all — not even the
    // refresh sessions. `PATCH /users/:id {password}` and `PATCH /auth/password`
    // are the same change by two routes, and only one of them logged the user out.
    it('revokes every session when an admin changes a role', async () => {
      await service.update('u1', { role: 'admin' });
      expect(revocation.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    it('revokes every session when an admin resets a password', async () => {
      await service.update('u1', { password: 'a-new-password-1234' });
      expect(revocation.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    it('revokes every session on soft-delete', async () => {
      await service.remove('u1');
      expect(revocation.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    // Not security-relevant, so it should not log anyone out of every device.
    it('does not revoke on a display-name edit', async () => {
      await service.update('u1', { displayName: 'New Name' });
      expect(revocation.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
