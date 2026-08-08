import { z } from 'zod'
import { analytics } from '../utils/analytics'
import { requireUserId } from '../utils/session'
import { parseOr400 } from '../utils/validation'

const Query = z.object({
  stalledAfter: z.coerce.number().int().min(1).max(365).optional(),
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const { stalledAfter } = parseOr400(Query, getQuery(event))
  return analytics(userId, stalledAfter ?? 30)
})
