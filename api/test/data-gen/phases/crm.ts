import { create, type GenContext } from '../context';
import * as f from '../fake';
import { VOLUME } from '../volume';

/**
 * Companies, contacts and the graph around them.
 *
 * Split across both principals because contact visibility is owner-scoped:
 * with one creator every read is "mine", and the access resolver is never
 * asked the question it exists to answer.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, stamp, pools } = ctx;
  client.beginSuite('crm');

  const SIZES = ['micro', 'small', 'medium', 'large', 'enterprise'] as const;
  const STATUSES = [
    'active',
    'active',
    'active',
    'inactive',
    'archived',
  ] as const;

  const totalCompanies = VOLUME.companies.admin + VOLUME.companies.user;
  for (let i = 0; i < totalCompanies; i += 1) {
    const actor = i < VOLUME.companies.admin ? 'admin' : 'user';
    const id = await create(ctx, 'contact_companies', {
      name: `company ${i}`,
      method: 'POST',
      path: '/companies',
      actor,
      body: {
        name: `${f.companyName(i)} ${stamp}-${i}`,
        legalName: `${f.companyName(i)} Pty Ltd`,
        domain: `gen${i}-${stamp}.example.com`,
        industry: f.industry(i),
        size: f.pick(SIZES, i),
        website: `https://gen${i}-${stamp}.example.com`,
        phone: `+61 2 5${String(550000 + i).slice(0, 6)}`,
        country: f.pick(['AU', 'NZ', 'GB', 'US', 'SG'], i),
        status: f.pick(STATUSES, i),
        description: f.paragraph(i, 2),
        taxNumber: `ABN ${String(10_000_000_000 + i * 7919).slice(0, 11)}`,
        // A quarter of them hang off another company, so the parent/child
        // read path has real data rather than a single hand-made pair.
        ...(i > 3 && i % 4 === 0 && pools.companyIds.length
          ? { parentCompanyId: f.pick(pools.companyIds, i) }
          : {}),
      },
      expect: 201,
    });
    if (id) pools.companyIds.push(id);
  }

  const CONTACT_STATUSES = [
    'active',
    'active',
    'inactive',
    'do_not_contact',
  ] as const;
  const SOURCES = [
    'manual',
    'import',
    'referral',
    'website',
    'inbound_email',
  ] as const;
  const totalContacts = VOLUME.contacts.admin + VOLUME.contacts.user;
  for (let i = 0; i < totalContacts; i += 1) {
    const actor = i < VOLUME.contacts.admin ? 'admin' : 'user';
    const id = await create(ctx, 'contacts', {
      name: `contact ${i}`,
      method: 'POST',
      path: '/contacts',
      actor,
      body: {
        firstName: f.first(i),
        lastName: f.last(i),
        displayName: `${f.fullName(i)} ${i}`,
        salutation: f.pick(['Dr', 'Mr', 'Ms', 'Mx'], i),
        primaryEmail: f.email(i, stamp),
        primaryPhone: `+61 4${String(10_000_000 + i * 137).slice(0, 8)}`,
        jobTitle: `${f.pick(['Head of', 'Lead', 'Senior', 'Principal'], i)} ${f.topic(i)}`,
        status: f.pick(CONTACT_STATUSES, i),
        source: f.pick(SOURCES, i),
        // Half shared, half private — the resolver needs both to be interesting.
        visibility: i % 2 === 0 ? 'shared' : 'private',
        country: f.pick(['AU', 'NZ', 'GB', 'US', 'SG'], i),
        timezone: 'Australia/Sydney',
        language: 'en',
        notes: f.paragraph(i, 2),
        address: {
          line1: `${100 + i} ${f.last(i)} Street`,
          city: f.pick(['Sydney', 'Melbourne', 'Brisbane', 'Perth'], i),
          region: f.pick(['NSW', 'VIC', 'QLD', 'WA'], i),
          postalCode: String(2000 + (i % 800)),
          country: 'Australia',
        },
        nextFollowUpAt: f.isoDateTime((i % 45) - 10),
        ...(pools.companyIds.length
          ? { companyId: f.pick(pools.companyIds, i) }
          : {}),
        ...(pools.contactTypeIds.length
          ? { typeId: f.pick(pools.contactTypeIds, i) }
          : {}),
        ...(pools.contactCategoryIds.length
          ? { categoryId: f.pick(pools.contactCategoryIds, i * 3) }
          : {}),
        // Populates contact_tags through the same call.
        ...(pools.tagIds.length
          ? {
              tagIds: [
                f.pick(pools.tagIds, i),
                f.pick(pools.tagIds, i * 5 + 2),
              ],
            }
          : {}),
      },
      expect: 201,
    });
    if (id) pools.contactIds.push(id);
  }

  if (pools.contactIds.length === 0) return;

  const CHANNEL_KINDS = [
    'email',
    'phone',
    'mobile',
    'fax',
    'website',
    'linkedin',
    'twitter',
    'wechat',
    'whatsapp',
    'other',
  ] as const;
  for (let i = 0; i < VOLUME.channels; i += 1) {
    const kind = f.pick(CHANNEL_KINDS, i);
    await create(ctx, 'contact_channels', {
      name: `channel ${kind} ${i}`,
      method: 'POST',
      path: '/contacts/{id}/channels',
      params: { id: f.pick(pools.contactIds, i) },
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: {
        kind,
        value: channelValue(kind, i, ctx.stamp),
        label: f.pick(['work', 'home', 'billing', 'support'], i),
        isPrimary: i % 7 === 0,
      },
      expect: [201, 400, 403, 409],
    });
  }

  const INTERACTION_KINDS = [
    'email_in',
    'email_out',
    'call',
    'meeting',
    'note',
    'task',
    'other',
  ] as const;
  for (let i = 0; i < VOLUME.interactions; i += 1) {
    await create(ctx, 'contact_interactions', {
      name: `interaction ${i}`,
      method: 'POST',
      path: '/contacts/{id}/interactions',
      params: { id: f.pick(pools.contactIds, i * 3) },
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: {
        kind: f.pick(INTERACTION_KINDS, i),
        occurredAt: f.isoDateTime(-(i % 120)),
        subject: `${f.pick(['Follow-up on', 'Intro call about', 'Notes from'], i)} ${f.topic(i)}`,
        body: f.paragraph(i, 3),
        direction: f.pick(['inbound', 'outbound', 'internal'], i),
        durationMinutes: (i % 8) * 15,
      },
      expect: [201, 403],
    });
  }

  // Relationships need two distinct contacts; the modulo walk guarantees it.
  for (
    let i = 0;
    i < VOLUME.relationships && pools.contactIds.length > 1;
    i += 1
  ) {
    const fromIdx = i % pools.contactIds.length;
    const toIdx = (i * 7 + 3) % pools.contactIds.length;
    if (fromIdx === toIdx) continue;
    await create(ctx, 'contact_relationships', {
      name: `relationship ${i}`,
      method: 'POST',
      path: '/contacts/{id}/relationships',
      params: { id: pools.contactIds[fromIdx] },
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: {
        toContactId: pools.contactIds[toIdx],
        type: f.pick(
          [
            'colleague',
            'reports_to',
            'manages',
            'friend',
            'referred_by',
            'introduced_by',
            'advisor_to',
            'family',
            'spouse',
            'other',
          ],
          i,
        ),
        strength: f.pick(['weak', 'moderate', 'strong'], i),
        since: f.isoDateTime(-(365 + i * 3)),
        note: `Recorded during the ${f.topic(i)} review.`,
      },
      expect: [201, 403, 409],
    });
  }
}

function channelValue(kind: string, i: number, stamp: string): string {
  switch (kind) {
    case 'email':
      return f.email(i + 500, stamp);
    case 'phone':
    case 'mobile':
    case 'fax':
      return `+61 3 ${String(90_000_000 + i * 31).slice(0, 8)}`;
    case 'website':
      return `https://gen${i}-${stamp}.example.com`;
    case 'linkedin':
      return `https://linkedin.test/in/${f.first(i).toLowerCase()}-${i}-${stamp}`;
    case 'twitter':
      return `@${f.first(i).toLowerCase()}${i}`;
    default:
      return `gen-${kind}-${i}-${stamp}`;
  }
}
