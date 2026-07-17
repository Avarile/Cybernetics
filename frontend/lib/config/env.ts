import { z } from 'zod'

const clientSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url('NEXT_PUBLIC_API_URL must be a valid URL'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Cybernetics'),
})

const serverSchema = z.object({
  API_URL: z.string().url('API_URL must be a valid URL'),
})

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

export function parseClientEnv(src: Record<string, string | undefined>) {
  const parsed = clientSchema.safeParse(src)
  if (!parsed.success) {
    throw new Error(`[env] Invalid client environment:\n${formatIssues(parsed.error)}`)
  }
  return { apiUrl: parsed.data.NEXT_PUBLIC_API_URL, appName: parsed.data.NEXT_PUBLIC_APP_NAME }
}

export function parseServerEnv(src: Record<string, string | undefined>) {
  const parsed = serverSchema.safeParse(src)
  if (!parsed.success) {
    throw new Error(`[env] Invalid server environment:\n${formatIssues(parsed.error)}`)
  }
  return { apiUrl: parsed.data.API_URL }
}

// Client env is evaluated eagerly. NEXT_PUBLIC_* must be referenced statically
// so Next.js inlines them into the client bundle.
export const clientEnv = parseClientEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
})

// Server env is lazy so it never evaluates in the client bundle.
export function serverEnv() {
  return parseServerEnv({ API_URL: process.env.API_URL })
}
