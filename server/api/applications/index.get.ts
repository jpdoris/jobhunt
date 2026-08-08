import { z } from 'zod'
import { MILESTONES, SORT_COLUMNS } from '#shared/types'
import { parseOr400 } from '../../utils/validation'
import { listApplications, milestoneCounts, statusCounts } from '../../utils/applications'
import { requireUserId } from '../../utils/session'

const Query = z.object({
  search: z.string().trim().min(1).optional(),
  statusId: z.coerce.number().int().positive().optional(),
  nextStepId: z.coerce.number().int().positive().optional(),
  appliedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  appliedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  submittedToUnemployment: z.coerce.boolean().optional(),
  milestone: z.enum(MILESTONES).optional(),
  // Zod enum, so an unknown column is a 400 rather than reaching ORDER BY.
  sort: z.enum(SORT_COLUMNS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const { sort, dir, ...filters } = parseOr400(Query, getQuery(event))
  const order = sort ? { column: sort, direction: dir ?? 'asc' } : undefined
  return {
    applications: listApplications(userId, filters, order),
    counts: statusCounts(userId),
    milestones: milestoneCounts(userId),
  }
})
