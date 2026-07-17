export type StrengthLabel = 'weak' | 'fair' | 'good' | 'strong'
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: StrengthLabel
}

const LABELS: StrengthLabel[] = ['weak', 'weak', 'fair', 'good', 'strong']

/**
 * No-dependency heuristic. Soft guidance only — never used to block a
 * length-valid password (the hard rule lives in passwordSchema).
 */
export function scorePassword(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: 'weak' }

  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/[0-9]/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw))

  let raw = 0
  if (pw.length >= 12) raw += 1
  if (pw.length >= 16) raw += 1
  if (classes >= 2) raw += 1
  if (classes >= 4) raw += 1

  const score = Math.min(4, raw) as PasswordStrength['score']
  return { score, label: LABELS[score] }
}
