import { z } from 'zod';

/**
 * Upsert a setting. `value` is validated against `type` so the stored JSON and
 * its declared type never diverge.
 */
export const upsertSettingSchema = z
  .object({
    value: z.unknown(),
    type: z.enum(['string', 'number', 'boolean', 'json']),
    category: z.string().min(1).max(100).default('general'),
    description: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    const ok =
      (data.type === 'string' && typeof data.value === 'string') ||
      (data.type === 'number' && typeof data.value === 'number') ||
      (data.type === 'boolean' && typeof data.value === 'boolean') ||
      (data.type === 'json' &&
        typeof data.value === 'object' &&
        data.value !== null);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value does not match declared type "${data.type}"`,
      });
    }
  });

export type UpsertSettingDto = z.infer<typeof upsertSettingSchema>;

/** Settings list filter (pagination + optional category). */
export const settingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  category: z.string().min(1).max(100).optional(),
});

export type SettingsQueryDto = z.infer<typeof settingsQuerySchema>;
