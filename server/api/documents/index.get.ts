import { z } from 'zod'
import { documentKinds, listDocuments } from '../../utils/documents'
import { requireUserId } from '../../utils/session'
import { parseOr400 } from '../../utils/validation'

const Query = z.object({
  kindId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const opts = parseOr400(Query, getQuery(event))
  return { documents: listDocuments(userId, opts), kinds: documentKinds() }
})
