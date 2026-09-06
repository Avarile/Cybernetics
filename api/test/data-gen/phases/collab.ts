import { create, type GenContext } from '../context';
import * as f from '../fake';
import { VOLUME } from '../volume';

/**
 * Comments and attachments across every entity type that accepts them.
 *
 * Deliberately spread over projects, tasks, knowledge, contacts and invoices:
 * comments and attachments resolve access through the EntityAccessRegistry, and
 * a corpus concentrated on one entity type would leave most of those resolvers
 * with nothing to answer for.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, pools } = ctx;
  client.beginSuite('collab');

  const targets: Array<{ type: string; ids: string[] }> = [
    { type: 'project', ids: pools.projectIds },
    { type: 'task', ids: pools.taskIds },
    { type: 'knowledge', ids: pools.knowledgeIds },
    { type: 'contact', ids: pools.contactIds },
    { type: 'invoice', ids: pools.invoiceIds },
  ].filter((t) => t.ids.length > 0);

  if (targets.length === 0) return;

  const roots: string[] = [];
  for (let i = 0; i < VOLUME.comments; i += 1) {
    const target = targets[i % targets.length];
    // Every fourth comment replies to an earlier one, so the thread shape is
    // real rather than a flat list.
    const asReply = i % 4 === 3 && roots.length > 0;
    const id = await create(ctx, 'comments', {
      name: `comment ${i}`,
      method: 'POST',
      path: '/comments',
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: {
        entityType: target.type,
        entityId: f.pick(target.ids, i),
        body: asReply
          ? `Agreed — ${f.paragraph(i, 1)}`
          : `${f.paragraph(i, 2)}`,
        ...(asReply ? { parentCommentId: f.pick(roots, i) } : {}),
        // Mentions are re-checked against the parent entity before dispatch,
        // so a mention of someone who cannot read it is dropped, not leaked.
        ...(i % 6 === 0 ? { mentionUserIds: [ctx.mockUserId] } : {}),
      },
      expect: [201, 200, 403],
    });
    if (id && !asReply) roots.push(id);
  }

  if (pools.fileIds.length === 0) return;

  const ATTACHABLE = [
    'project',
    'task',
    'knowledge',
    'contact',
    'invoice',
  ] as const;
  const KINDS = ['document', 'image', 'receipt', 'contract', 'other'] as const;
  for (let i = 0; i < VOLUME.attachments; i += 1) {
    const type = f.pick(ATTACHABLE, i);
    const pool = targets.find((t) => t.type === type);
    if (!pool) continue;
    await create(ctx, 'entity_attachments', {
      name: `attachment ${i}`,
      method: 'POST',
      path: '/attachments',
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: {
        entityType: type,
        entityId: f.pick(pool.ids, i),
        fileId: f.pick(pools.fileIds, i),
        kind: f.pick(KINDS, i),
        label: `Supporting material for ${f.topic(i)}`,
        sortOrder: i % 10,
      },
      expect: [201, 200, 403, 409],
    });
  }
}
