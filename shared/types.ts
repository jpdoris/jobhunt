/** Shared between server and client. Mirrors docs/schema.sql. */

export interface LookupOption {
  id: number
  label: string
  sortOrder: number
  isActive: boolean
}

export interface StatusOption extends LookupOption {
  isTerminal: boolean
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
  isTerminal: boolean
  nextStepId: number
  nextStepLabel: string
  /** UTC instant `YYYY-MM-DD HH:MM:SS`. Always rendered in the viewer's zone. */
  nextStepDateTime: string | null
  notes: string | null
  submittedToUnemployment: boolean
  createdAt: string
  updatedAt: string
}

export interface StatusCount {
  statusId: number
  label: string
  isTerminal: boolean
  count: number
}

export interface ApplicationFilters {
  search?: string
  statusId?: number
  nextStepId?: number
  appliedFrom?: string
  appliedTo?: string
  submittedToUnemployment?: boolean
}

/**
 * Tag variant per status. The design ships three tag treatments; map by
 * pipeline position rather than by label so relabelling a status in
 * docs/schema.sql does not silently fall back to the neutral tag.
 */
export function statusTagClass(status: { label: string; isTerminal: boolean }): string {
  if (status.isTerminal) return 'tag-neutral'
  if (/^Interview/i.test(status.label)) return 'tag-accent'
  if (/^Offer/i.test(status.label)) return 'tag-accent-2'
  return 'tag-neutral'
}
