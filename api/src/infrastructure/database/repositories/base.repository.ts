import { eq, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DrizzleDB } from '../drizzle.constants';

/** A Drizzle table that exposes an `id` primary-key column. */
type TableWithId = PgTable & { id: PgColumn };

/**
 * Thin base repository over a Drizzle table, providing common CRUD helpers.
 * Feature repositories extend it, passing the injected `db` and their table:
 *
 *   @Injectable()
 *   export class UserRepository extends BaseRepository<typeof users> {
 *     constructor(@Inject(DRIZZLE) db: DrizzleDB) {
 *       super(db, users);
 *     }
 *   }
 *
 * Drizzle's query types are heavily inferred; the internal casts below are the
 * accepted cost of a generic repository. Direct `db` usage in a feature
 * repository remains fully type-safe.
 */
export abstract class BaseRepository<TTable extends TableWithId> {
  constructor(
    protected readonly db: DrizzleDB,
    protected readonly table: TTable,
  ) {}

  protected get id(): PgColumn {
    return this.table.id;
  }

  async findAll(): Promise<InferSelectModel<TTable>[]> {
    const rows = await this.db.select().from(this.table as PgTable);
    return rows as InferSelectModel<TTable>[];
  }

  async findById(
    id: InferSelectModel<TTable>['id'],
  ): Promise<InferSelectModel<TTable> | null> {
    const rows = await this.db
      .select()
      .from(this.table as PgTable)
      .where(eq(this.id, id))
      .limit(1);
    return (rows[0] as InferSelectModel<TTable>) ?? null;
  }

  async create(
    values: InferInsertModel<TTable>,
  ): Promise<InferSelectModel<TTable>> {
    const rows = await this.db
      .insert(this.table)
      .values(values as never)
      .returning();
    return rows[0] as InferSelectModel<TTable>;
  }

  async deleteById(id: InferSelectModel<TTable>['id']): Promise<void> {
    await this.db.delete(this.table).where(eq(this.id, id));
  }
}
