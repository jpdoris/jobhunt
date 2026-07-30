import { z } from 'zod'
import { parseOr400 } from '../../utils/validation'
import { listApplications, statusCounts } from '../../utils/applications'
import { requireUserId } from '../../utils/session'

const Query = z.object({
  search: z.string().trim().min(1).optional(),
  statusId: z.coerce.number().int().positive().optional(),
  nextStepId: z.coerce.number().int().positive().optional(),
  appliedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  appliedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  submittedToUnemployment: z.coerce.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const filters = parseOr400(Query, getQuery(event))
  return {
    applications: listApplications(userId, filters),
    counts: statusCounts(userId),
  }
})
