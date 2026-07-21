import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A batch of records to persist. `externalId` enables idempotent upsert. */
export const persistRecordsSchema = z.object({
  records: z
    .array(
      z.object({
        externalId: z.string().min(1).max(255).optional(),
        document: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(1000),
});

export class PersistRecordsDto extends createZodDto(persistRecordsSchema) {}
