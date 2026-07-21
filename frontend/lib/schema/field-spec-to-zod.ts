import { z } from 'zod'

/** Identity-field schema for the collection editor form (name/displayName/description). */
export const collectionFormSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case').max(100),
  displayName: z.string().min(1, 'Required').max(255),
  description: z.string().max(500).optional(),
})
export type CollectionFormValues = z.infer<typeof collectionFormSchema>
