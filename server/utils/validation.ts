import type { z } from 'zod'

// Explicit .ts path: scripts/add-application.ts imports this module under plain
// Node, which neither guesses extensions nor knows Nuxt's aliases.
export { ApplicationInput, HistoryEventInput } from '../../shared/schemas.ts'

/**
 * A raw ZodError escapes as a 500. Bad input is the client's fault, so translate
 * it to a 400 carrying the field errors.
 */
export function parseOr400<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const issues = result.error.issues.map((i) => ({
    field: i.path.join('.') || '(root)',
    message: i.message,
  }))
  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid input',
    message: issues.map((i) => `${i.field}: ${i.message}`).join('; '),
    data: { issues },
  })
}
