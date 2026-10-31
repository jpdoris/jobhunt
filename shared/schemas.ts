/**
 * Request schemas. In shared/ because the Application type is derived from
 * ApplicationInput (shared/types.ts), so a column is declared once for both the
 * API's input and its output. The app imports this as a type only, so zod never
 * reaches the client bundle; parseOr400 stays server-side in validation.ts.
 */
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
  /** Which version of the pitch went out, e.g. "Senior Vue frontend". */
  angle: z.preprocess(blankToNull, z.string().trim().nullable()).default(null),
  /** The employer's own id for the posting, e.g. "1693". Optional. */
  jobReqId: z.preprocess(blankToNull, z.string().trim().nullable()).default(null),
  submittedToUnemployment: z.coerce.boolean().default(false),
  /** Optional: when this status change actually happened. Defaults to now. */
  statusChangedAt: z.preprocess(blankToNull, z.string().regex(DATETIME).nullable()).optional(),
})

export const HistoryEventInput = z.object({
  statusId: z.coerce.number().int().positive(),
  /** Same UTC shape the column CHECK enforces, so a bad value is a 400 not a 500. */
  changedAt: z.string().regex(DATETIME, 'Expected YYYY-MM-DD HH:MM:SS in UTC'),
})

export type ApplicationInput = z.infer<typeof ApplicationInput>
