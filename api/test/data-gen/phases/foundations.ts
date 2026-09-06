import { create, type GenContext } from '../context';
import * as f from '../fake';
import { VOLUME } from '../volume';

/**
 * Vocabularies, tags, files, extra accounts and the per-user permission
 * exceptions.
 *
 * Runs first because almost everything later references one of these: a
 * contact wants a type, a knowledge record wants a category, an attachment
 * wants a file.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, stamp, pools } = ctx;
  client.beginSuite('foundations');

  const TAG_SCOPES = [
    'knowledge',
    'contact',
    'project',
    'task',
    'shared',
  ] as const;
  for (let i = 0; i < VOLUME.tags; i += 1) {
    const id = await create(ctx, 'tags', {
      name: `tag ${i}`,
      method: 'POST',
      path: '/tags',
      actor: i % 3 === 0 ? 'user' : 'admin',
      body: {
        key: `gen-${f.topic(i).replace(/\s+/g, '-')}-${i}-${stamp}`.toLowerCase(),
        label: `${f.topic(i)} ${i}`,
        scope: f.pick(TAG_SCOPES, i),
        color: `#${(0x334455 + i * 4099).toString(16).slice(0, 6)}`,
        description: `Generated tag for ${f.topic(i)}.`,
      },
    });
    if (id) pools.tagIds.push(id);
  }

  for (let i = 0; i < VOLUME.contactTypes; i += 1) {
    const id = await create(ctx, 'contact_types', {
      name: `contact type ${i}`,
      method: 'POST',
      path: '/contact-vocabulary/types',
      actor: 'admin',
      body: {
        key: `gen_ct_${i}_${stamp}`,
        name: `${f.industry(i)} contact`,
        description: `Contacts sourced from ${f.industry(i).toLowerCase()}.`,
        sortOrder: i,
      },
    });
    if (id) pools.contactTypeIds.push(id);
  }

  for (let i = 0; i < VOLUME.contactCategories; i += 1) {
    const id = await create(ctx, 'contact_categories', {
      name: `contact category ${i}`,
      method: 'POST',
      path: '/contact-vocabulary/categories',
      actor: 'admin',
      body: {
        key: `gen_cc_${i}_${stamp}`,
        name: `${f.topic(i)} accounts`,
        sortOrder: i,
      },
    });
    if (id) pools.contactCategoryIds.push(id);
  }

  for (let i = 0; i < VOLUME.knowledgeTypes; i += 1) {
    const id = await create(ctx, 'knowledge_types', {
      name: `knowledge type ${i}`,
      method: 'POST',
      path: '/knowledge-vocabulary/types',
      actor: 'admin',
      body: {
        key: `gen_kt_${i}_${stamp}`,
        name: `${f.topic(i)} document`,
        // Drives reviewDueAt, so the review sweep has something to find.
        defaultReviewIntervalDays: 30 + i * 15,
        sortOrder: i,
      },
    });
    if (id) pools.knowledgeTypeIds.push(id);
  }

  for (let i = 0; i < VOLUME.knowledgeCategories; i += 1) {
    const id = await create(ctx, 'knowledge_categories', {
      name: `knowledge category ${i}`,
      method: 'POST',
      path: '/knowledge-vocabulary/categories',
      actor: 'admin',
      body: {
        key: `gen_kc_${i}_${stamp}`,
        name: `${f.topic(i)} library`,
        sortOrder: i,
      },
    });
    if (id) pools.knowledgeCategoryIds.push(id);
  }

  await files(ctx);
  await accounts(ctx);
  await overrides(ctx);
  await preferences(ctx);
}

/** Real presigned uploads: a PENDING file is not attachable. */
async function files(ctx: GenContext): Promise<void> {
  const { client, stamp, pools } = ctx;
  const { createHash } = await import('node:crypto');

  for (let i = 0; i < VOLUME.files; i += 1) {
    const actor = i % 2 === 0 ? 'admin' : 'user';
    const content = Buffer.from(
      `Generated fixture ${i} for run ${stamp}.\n${f.paragraph(i, 4)}\n`,
      'utf8',
    );
    const sha256 = createHash('sha256').update(content).digest('hex');
    const filename = `gen-${i}-${stamp}.txt`;

    const res = await client.call({
      name: `initiate file ${i}`,
      method: 'POST',
      path: '/files',
      actor,
      body: {
        filename,
        mimeType: 'text/plain',
        size: content.length,
        sha256,
        metadata: { source: 'data-gen', run: stamp, index: i },
      },
      expect: 201,
    });
    if (!res.ok || !res.body?.fileId) {
      ctx.report.bad('files', res.status, JSON.stringify(res.body ?? {}));
      continue;
    }

    // Straight to object storage with the policy just issued — not an API call.
    const uploaded = await postToStorage(res.body.upload, content, filename);
    if (uploaded < 200 || uploaded >= 400) {
      ctx.report.bad('files', uploaded, 'object storage rejected the upload');
      continue;
    }

    const done = await client.call({
      name: `complete file ${i}`,
      method: 'POST',
      path: '/files/{id}/complete',
      params: { id: res.body.fileId },
      actor,
      body: { sha256 },
      expect: [200, 201],
    });
    if (done.ok) {
      ctx.report.ok('files');
      pools.fileIds.push(res.body.fileId);
    } else {
      ctx.report.bad('files', done.status, JSON.stringify(done.body ?? {}));
    }
  }
}

/** Extra accounts, so membership and assignment have more than two people. */
async function accounts(ctx: GenContext): Promise<void> {
  const { stamp, pools } = ctx;
  for (let i = 0; i < VOLUME.extraUsers; i += 1) {
    const id = await create(ctx, 'users', {
      name: `extra user ${i}`,
      method: 'POST',
      path: '/users',
      actor: 'admin',
      body: {
        email: f.email(i + 200, stamp),
        password: 'Generated-Fixture-Pw-1!',
        role: 'user',
        displayName: f.fullName(i + 200),
      },
      expect: 201,
    });
    if (!id) continue;
    pools.extraUserIds.push(id);
    // POST /users writes users.role but no user_roles row, and the resolver
    // reads grants exclusively from user_roles.
    await create(ctx, 'user_roles', {
      name: `baseline role for extra user ${i}`,
      method: 'POST',
      path: '/authorization/users/{userId}/roles',
      params: { userId: id },
      actor: 'admin',
      body: {
        roleKey: f.pick(['user', 'finance_viewer', 'project_manager'], i),
      },
      expect: 204,
    });
  }
}

/**
 * Per-user permission exceptions — the table this run exists partly to fill.
 *
 * Both effects are used: `allow` widens one account beyond its role, `deny`
 * narrows another, which is the half of the model that had no write path at
 * all before this run.
 */
async function overrides(ctx: GenContext): Promise<void> {
  const { pools, mockUserId } = ctx;
  const catalog = await ctx.client.call({
    name: 'read the permission catalog',
    method: 'GET',
    path: '/authorization/permissions',
    actor: 'admin',
    expect: 200,
  });
  const keys: string[] = Array.isArray(catalog.body)
    ? catalog.body.map((p: any) => p.key).filter(Boolean)
    : [];
  pools.permissionKeys = keys;
  if (keys.length === 0) return;

  const targets = [mockUserId, ...pools.extraUserIds].filter(Boolean);
  for (let i = 0; i < VOLUME.permissionOverrides; i += 1) {
    const userId = f.pick(targets, i);
    const permissionKey = f.pick(keys, i * 3 + 1);
    const effect = i % 3 === 0 ? 'deny' : 'allow';
    await create(ctx, 'user_permissions', {
      name: `${effect} ${permissionKey}`,
      method: 'POST',
      path: '/authorization/users/{userId}/permissions',
      params: { userId },
      actor: 'admin',
      body: {
        permissionKey,
        effect,
        reason:
          effect === 'deny'
            ? `Temporarily withdrawn pending the ${f.topic(i)} review.`
            : `Covering ${f.topic(i)} while the owner is on leave.`,
        ...(i % 4 === 0 ? { expiresAt: f.isoDateTime(30 + i) } : {}),
      },
      expect: 204,
    });
  }
}

async function preferences(ctx: GenContext): Promise<void> {
  const KEYS = [
    'ui.theme',
    'ui.density',
    'ui.locale',
    'list.pageSize',
    'digest.frequency',
    'board.defaultView',
    'timezone.display',
    'editor.mode',
    'table.striped',
    'notifications.sound',
  ];
  const VALUES: unknown[] = [
    'dark',
    'compact',
    'en-AU',
    50,
    'daily',
    'board',
    'local',
    'markdown',
    true,
    false,
  ];
  for (let i = 0; i < VOLUME.preferences; i += 1) {
    const value = VALUES[i % VALUES.length];
    await create(ctx, 'user_preferences', {
      name: `preference ${KEYS[i % KEYS.length]}`,
      method: 'PUT',
      path: '/me/preferences/{key}',
      params: { key: KEYS[i % KEYS.length] },
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: { value },
      expect: [200, 201, 204],
    });
  }
}

/** Perform the presigned POST exactly as a browser form would. */
async function postToStorage(
  policy: { url: string; fields: Record<string, string> },
  content: Buffer,
  filename: string,
): Promise<number> {
  const form = new FormData();
  for (const [key, value] of Object.entries(policy.fields)) {
    form.append(key, String(value));
  }
  // The file part must come last — S3 policy evaluation ignores anything after.
  const bytes = new Uint8Array(content.byteLength);
  bytes.set(content);
  form.append('file', new Blob([bytes], { type: 'text/plain' }), filename);
  try {
    const res = await fetch(policy.url, { method: 'POST', body: form });
    return res.status;
  } catch {
    return 0;
  }
}
