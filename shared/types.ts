/** Shared between server and client. Mirrors docs/schema.sql. */

export interface LookupOption {
  id: number
  label: string
  sortOrder: number
  isActive: boolean
}

/** `next_step` specifically. The other lookups have no flags of their own. */
export interface NextStepOption extends LookupOption {
  /** The "nothing pending" option. An application whose status turns terminal
   *  is moved to it automatically and loses its next-step date. Flagged rather
   *  than matched on the label 'None' — see CLAUDE.md rule 3. */
  isNone: boolean
}

export const STATUS_TONES = ['quiet', 'active', 'positive', 'closed'] as const
export type StatusTone = (typeof STATUS_TONES)[number]

export interface StatusOption extends LookupOption {
  isTerminal: boolean
  tone: StatusTone
  /** Reaching this status means an interview happened. "Interview scheduled"
   *  is false — booked is not completed. */
  isInterview: boolean
  /** Reaching this status means an offer was made. "Offer declined" is true —
   *  you can only decline one you were given. */
  isOffer: boolean
}

/**
 * How far an application ever got, as opposed to where it sits now. Every
 * other filter on the list asks the second question; these ask the first, so
 * a rejected application still counts as having reached an interview.
 *
 * `open` and `closedNoOffer` are present-tense by nature, but they span
 * several statuses each, so the single-status filter cannot express them.
 */
export const MILESTONES = ['interviewed', 'offered', 'open', 'closedNoOffer'] as const
export type Milestone = (typeof MILESTONES)[number]

export const MILESTONE_LABELS: Record<Milestone, string> = {
  interviewed: 'Interviewed',
  offered: 'Offers',
  open: 'Still open',
  closedNoOffer: 'Closed, no offer',
}

/** Absolute counts, unaffected by the active filters — same as StatusCount. */
export interface MilestoneCounts extends Record<Milestone, number> {
  total: number
}

export interface Application {
  id: number
  company: string
  role: string | null
  description: string | null
  jobPostingLink: string | null
  contact: string | null
  /** Floating calendar date `YYYY-MM-DD`. Never timezone-converted. */
  applyDate: string | null
  statusId: number
  statusLabel: string
  statusTone: StatusTone
  isTerminal: boolean
  nextStepId: number
  nextStepLabel: string
  /** UTC instant `YYYY-MM-DD HH:MM:SS`. Always rendered in the viewer's zone. */
  nextStepDateTime: string | null
  /** When the current status began; null if the timeline is empty. */
  statusChangedAt: string | null
  notes: string | null
  submittedToUnemployment: boolean
  createdAt: string
  updatedAt: string
}

export interface StatusEvent {
  id: number
  statusId: number
  statusLabel: string
  statusTone: StatusTone
  /** UTC instant `YYYY-MM-DD HH:MM:SS`, rendered in the viewer's zone. */
  changedAt: string
}

export interface Analytics {
  total: number
  live: number
  ended: number
  /** Applications that reached an interview. Counted from history OR current
   *  status, so the 200-odd rows with no history still count. */
  interviewed: number
  byStatus: { label: string; tone: string; isTerminal: boolean; count: number }[]
  perMonth: { month: string; count: number }[]
  stalledAfterDays: number
  stalled: { id: number; company: string; role: string | null; statusLabel: string; days: number }[]
  durations: {
    /** Every duration carries n — a median of four is not a trend. */
    response: { n: number; median: number | null; values: number[] }
    rejection: { n: number; median: number | null }
    offer: { n: number; median: number | null }
    withHistory: number
  }
}

export interface StatusCount {
  statusId: number
  label: string
  isTerminal: boolean
  count: number
}

export interface DocumentKind {
  id: number
  label: string
  sortOrder: number
}

export interface DocumentRecord {
  id: number
  kindId: number
  kindLabel: string
  title: string
  /** Relative to data/documents/. Null for text-only entries. */
  filePath: string | null
  mimeType: string | null
  byteSize: number | null
  /** Only populated on the single-document endpoint; null in list responses. */
  contentText: string | null
  /** Whether search can see this document at all. */
  hasText: boolean
  attachedCount: number
  createdAt: string
  updatedAt: string
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const SORT_COLUMNS = [
  'company',
  'role',
  'status',
  'nextStep',
  'when',
  'applied',
  'filed',
] as const

export type SortColumn = (typeof SORT_COLUMNS)[number]
export type SortDirection = 'asc' | 'desc'

export const DEFAULT_SORT: { column: SortColumn; direction: SortDirection } = {
  column: 'applied',
  direction: 'desc',
}

/** Which way a column runs when you first click it. Dates and flags are most
 *  useful newest/true-first; text reads better A→Z. */
export const FIRST_CLICK_DIRECTION: Record<SortColumn, SortDirection> = {
  company: 'asc',
  role: 'asc',
  status: 'asc',
  nextStep: 'asc',
  when: 'desc',
  applied: 'desc',
  filed: 'desc',
}

export interface ApplicationFilters {
  search?: string
  statusId?: number
  nextStepId?: number
  appliedFrom?: string
  appliedTo?: string
  submittedToUnemployment?: boolean
  /** One milestone at a time, like the status tiles. Composes with the other
   *  filters, so "reached an interview, now rejected" is expressible. */
  milestone?: Milestone
}

/**
 * Tag variant for a status. Driven by the status's own `tone` column, so
 * relabelling a status never changes its colour and a new status cannot fall
 * through to a wrong default — see CLAUDE.md rule 3.
 */
export function statusTagClass(status: { statusTone: StatusTone }): string {
  return `tag-${status.statusTone}`
}
