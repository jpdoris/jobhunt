import { z } from 'zod'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

const blankToNull = (v: unknown) => (v === '' || v === undefined ? null : v)

export const ApplicationInput = z.object({
  company: z.string().trim().min(1, 'Company is required'),
  role: z.preprocess(blankToNull, z.string().trim().nullable()),
  description: z.preprocess(blankToNull, z.string().nullable()),
  jobPostingLink: z.preprocess(blankToNull, z.string().url().nullable()),
  contact: z.preprocess(blankToNull, z.string().email().nullable()),
  /** Floating calendar date — stored and compared as text, never converted. */
  applyDate: z.preprocess(blankToNull, z.string().regex(DATE).nullable()),
  statusId: z.coerce.number().int().positive(),
  nextStepId: z.coerce.number().int().positive(),
  /** UTC instant. The client converts from local before sending. */
  nextStepDateTime: z.preprocess(blankToNull, z.string().regex(DATETIME).nullable()),
  notes: z.preprocess(blankToNull, z.string().nullable()),
  submittedToUnemployment: z.coerce.boolean().default(false),
})

export type ApplicationInput = z.infer<typeof ApplicationInput>

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
