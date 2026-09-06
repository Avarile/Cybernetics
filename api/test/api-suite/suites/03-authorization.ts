import { isoDateTime } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * Role and permission administration, plus the live proof that a grant takes
 * effect immediately.
 *
 * The grant/revoke cycle in the middle of this suite is the important one: the
 * resolver caches effective permissions per subject, so a grant that is not
 * followed by an invalidation looks correct in the database and does nothing to
 * the running process. Asserting 403 → grant → 200 → revoke → 403 against the
 * live server is the only way to see that.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const user = client.principal('user');

  // ------------------------------------------------------------- the catalog

  await client.call({
    name: 'admin lists the permission catalog',
    method: 'GET',
    path: '/authorization/permissions',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      if (rows.length === 0) return 'catalog is empty — seeds have not run';
      const keys = new Set(rows.map((r) => r.key));
      const expected = [
        'contact.read',
        'project.read',
        'finance.read',
        'rbac.manage',
      ];
      const missing = expected.filter((k) => !keys.has(k));
      return missing.length
        ? `catalog missing ${missing.join(', ')}`
        : undefined;
    },
  });

  await client.call({
    name: 'admin lists roles with their grants',
    method: 'GET',
    path: '/authorization/roles',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      for (const key of [
        'admin',
        'user',
        'agent',
        'project_manager',
        'finance_manager',
      ]) {
        if (!byKey.has(key)) return `role "${key}" is not seeded`;
      }
      const baseline = byKey.get('user');
      if (!baseline?.permissions?.includes('contact.create')) {
        return 'the "user" role no longer carries its documented baseline grants';
      }
      if ((byKey.get('admin')?.permissions ?? []).length !== 0) {
        return 'the "admin" role carries explicit grants — admin is meant to short-circuit';
      }
      return undefined;
    },
  });

  await client.call({
    name: 'a standard user cannot read the permission catalog',
    method: 'GET',
    path: '/authorization/permissions',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'a standard user cannot list roles',
    method: 'GET',
    path: '/authorization/roles',
    actor: 'user',
    expect: 403,
  });

  // ------------------------------- a freshly provisioned account has no grants

  const probeEmail = `apisuite.grantprobe.${stamp}@cybernetics.test`;
  const probe = await client.call({
    name: 'admin provisions a probe account',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: {
      email: probeEmail,
      password: 'Grant-Probe-Password-1!',
      role: 'user',
    },
    expect: 201,
  });

  if (probe.ok) {
    const probeId = probe.body.id as string;

    // Provisioning assigns the role that mirrors `users.role`. It used not to,
    // and because the resolver reads user grants only from `user_roles`, every
    // account created through the API resolved to zero permissions until an
    // admin granted the role by hand.
    await client.call({
      name: 'a new account is assigned the role matching its user_role',
      method: 'GET',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        const keys = rows.map((r) => r.key ?? r.roleKey);
        return keys.length === 1 && keys[0] === 'user'
          ? undefined
          : `expected exactly [user], got [${keys.join(', ')}]`;
      },
    });

    // The point of that assignment: the account can do what the `user` role
    // documents without an administrator intervening first.
    await client.call({
      name: 'a new account resolves to the baseline permissions',
      method: 'GET',
      path: '/authorization/users/{userId}/effective',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: string[] = Array.isArray(b) ? b : (b?.data ?? []);
        const missing = [
          'contact.read',
          'contact.create',
          'knowledge.create',
          'project.task.create',
          'project.time.log',
        ].filter((k) => !rows.includes(k));
        return missing.length ? `missing ${missing.join(', ')}` : undefined;
      },
    });

    await client.call({
      name: 'granting a role the account already holds is idempotent',
      method: 'POST',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      body: { roleKey: 'user' },
      expect: [204, 409],
    });

    await client.call({
      name: 'the repeat grant does not duplicate the assignment',
      method: 'GET',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        const held = rows.filter((r) => (r.key ?? r.roleKey) === 'user');
        return held.length === 1
          ? undefined
          : `expected one "user" assignment, got ${held.length}`;
      },
    });

    await client.call({
      name: 'granting an unknown role is refused',
      method: 'POST',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      body: { roleKey: 'sovereign' },
      expect: [400, 404, 422],
    });

    await client.call({
      name: 'an already-expired grant confers nothing',
      method: 'POST',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      body: { roleKey: 'finance_viewer', expiresAt: isoDateTime(-1) },
      expect: [204, 400, 422],
    });

    await client.call({
      name: 'the expired grant is not in effect',
      method: 'GET',
      path: '/authorization/users/{userId}/effective',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: string[] = Array.isArray(b) ? b : (b?.data ?? []);
        return rows.includes('finance.read')
          ? 'an expired grant is being honoured'
          : undefined;
      },
    });

    await client.call({
      name: 'admin removes the probe account',
      method: 'DELETE',
      path: '/users/{id}',
      params: { id: probeId },
      actor: 'admin',
      expect: 204,
    });
  }

  // ------------------------- grant takes effect immediately on a live session

  await client.call({
    name: 'before the grant, the mock user cannot read finance',
    method: 'GET',
    path: '/finance/accounts',
    actor: 'user',
    expect: 403,
  });

  const granted = await client.call({
    name: 'admin grants finance_viewer to the mock user',
    method: 'POST',
    path: '/authorization/users/{userId}/roles',
    params: { userId: user.userId },
    actor: 'admin',
    body: { roleKey: 'finance_viewer' },
    expect: 204,
  });

  if (granted.ok) {
    await client.call({
      name: 'the grant is visible to the mock user’s existing token',
      method: 'GET',
      path: '/finance/accounts',
      actor: 'user',
      expect: 200,
    });

    await client.call({
      name: 'admin revokes finance_viewer',
      method: 'DELETE',
      path: '/authorization/users/{userId}/roles/{roleKey}',
      params: { userId: user.userId, roleKey: 'finance_viewer' },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the revocation takes effect immediately too',
      method: 'GET',
      path: '/finance/accounts',
      actor: 'user',
      expect: 403,
    });
  }

  await client.call({
    name: 'revoking a role the user does not hold is not an error',
    method: 'DELETE',
    path: '/authorization/users/{userId}/roles/{roleKey}',
    params: { userId: user.userId, roleKey: 'finance_viewer' },
    actor: 'admin',
    expect: [204, 404],
  });

  await client.call({
    name: 'a standard user cannot grant itself a role',
    method: 'POST',
    path: '/authorization/users/{userId}/roles',
    params: { userId: user.userId },
    actor: 'user',
    body: { roleKey: 'admin' },
    expect: 403,
  });

  await client.call({
    name: 'a standard user cannot read its own effective permissions here',
    method: 'GET',
    path: '/authorization/users/{userId}/effective',
    params: { userId: user.userId },
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'the mock user retains exactly the baseline role',
    method: 'GET',
    path: '/authorization/users/{userId}/roles',
    params: { userId: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const keys = rows.map((r) => r.key ?? r.roleKey).sort();
      return keys.join(',') === 'user'
        ? undefined
        : `expected exactly [user], got [${keys.join(', ')}]`;
    },
  });
}
