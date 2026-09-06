import type { ApiClient } from '../api-suite/harness/client';
import type { CallOptions } from '../api-suite/harness/types';

/**
 * Everything a phase needs, plus the pools of ids earlier phases produced.
 *
 * One flat bag rather than per-phase returns, for the same reason the
 * assertion suite uses one: the graph is genuinely cross-cutting — an invoice
 * bills time logged on a task in a project linked to a contact — and threading
 * that through signatures obscures more than it documents.
 */
export interface Pools {
  tagIds: string[];
  contactTypeIds: string[];
  contactCategoryIds: string[];
  knowledgeTypeIds: string[];
  knowledgeCategoryIds: string[];
  fileIds: string[];
  extraUserIds: string[];
  companyIds: string[];
  contactIds: string[];
  knowledgeIds: string[];
  projectIds: string[];
  milestoneIds: string[];
  taskIds: string[];
  /** Tasks keyed by project, so dependencies stay inside one project. */
  tasksByProject: Map<string, string[]>;
  timeEntryIds: string[];
  accountIds: string[];
  categoryIds: string[];
  invoiceIds: string[];
  collectionNames: string[];
  permissionKeys: string[];
  currency: string;
}

export interface GenContext {
  client: ApiClient;
  stamp: string;
  adminUserId: string;
  mockUserId: string;
  pools: Pools;
  report: GenReport;
}

export function emptyPools(): Pools {
  return {
    tagIds: [],
    contactTypeIds: [],
    contactCategoryIds: [],
    knowledgeTypeIds: [],
    knowledgeCategoryIds: [],
    fileIds: [],
    extraUserIds: [],
    companyIds: [],
    contactIds: [],
    knowledgeIds: [],
    projectIds: [],
    milestoneIds: [],
    taskIds: [],
    tasksByProject: new Map(),
    timeEntryIds: [],
    accountIds: [],
    categoryIds: [],
    invoiceIds: [],
    collectionNames: [],
    permissionKeys: [],
    currency: 'AUD',
  };
}

/**
 * Per-entity tally of what was actually created.
 *
 * Counted from responses rather than from the volume config: the point of the
 * run is to find out what the API accepted, and a plan is not a result.
 */
export class GenReport {
  private readonly created = new Map<string, number>();
  private readonly failed = new Map<string, number>();
  readonly failures: Array<{ entity: string; status: number; detail: string }> =
    [];

  ok(entity: string): void {
    this.created.set(entity, (this.created.get(entity) ?? 0) + 1);
  }

  bad(entity: string, status: number, detail: string): void {
    this.failed.set(entity, (this.failed.get(entity) ?? 0) + 1);
    // Bounded: one bad payload repeated 200 times is one problem, and printing
    // it 200 times buries every other one.
    if (this.failures.filter((f) => f.entity === entity).length < 3) {
      this.failures.push({ entity, status, detail });
    }
  }

  countOf(entity: string): number {
    return this.created.get(entity) ?? 0;
  }

  print(): void {
    const names = [
      ...new Set([...this.created.keys(), ...this.failed.keys()]),
    ].sort();
    const width = Math.max(...names.map((n) => n.length), 10);
    let totalOk = 0;
    let totalBad = 0;
    console.log('\n' + '='.repeat(78));
    console.log('GENERATED RECORDS');
    console.log('='.repeat(78));
    for (const name of names) {
      const ok = this.created.get(name) ?? 0;
      const bad = this.failed.get(name) ?? 0;
      totalOk += ok;
      totalBad += bad;
      console.log(
        `  ${name.padEnd(width)}  ${String(ok).padStart(5)}` +
          (bad > 0 ? `   ${bad} failed` : ''),
      );
    }
    console.log('-'.repeat(78));
    console.log(
      `  ${'TOTAL'.padEnd(width)}  ${String(totalOk).padStart(5)} created, ${totalBad} failed`,
    );

    if (this.failures.length > 0) {
      console.log('\nFirst failures per entity:');
      for (const f of this.failures) {
        console.log(`  ${f.entity} → ${f.status}: ${f.detail.slice(0, 160)}`);
      }
    }
  }

  get totalCreated(): number {
    return [...this.created.values()].reduce((a, b) => a + b, 0);
  }

  get totalFailed(): number {
    return [...this.failed.values()].reduce((a, b) => a + b, 0);
  }
}

/**
 * Issue one create call and record the outcome against `entity`.
 *
 * Returns the new row's id, or undefined when the call did not succeed —
 * callers push only defined ids into their pools, so a failure narrows the
 * corpus rather than poisoning later phases with a bad reference.
 */
export async function create(
  ctx: GenContext,
  entity: string,
  opts: CallOptions,
): Promise<string | undefined> {
  const res = await ctx.client.call({ expect: [200, 201, 204], ...opts });
  if (!res.ok) {
    ctx.report.bad(
      entity,
      res.status,
      typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {}),
    );
    return undefined;
  }
  ctx.report.ok(entity);
  const body: any = res.body;
  return body?.id ?? body?.key ?? body?.name ?? undefined;
}
