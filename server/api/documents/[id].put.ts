import { z } from 'zod'
import { getDocument, updateDocument } from '../../utils/documents'
import { requireUserId } from '../../utils/session'
import { parseOr400 } from '../../utils/validation'

const Body = z.object({
  title: z.string().trim().min(1),
  kindId: z.coerce.number().int().positive(),
  contentText: z.preprocess((v) => (v === '' ? null : v), z.string().nullable()),
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const input = parseOr400(Body, await readBody(event))
  if (!updateDocument(userId, id, input)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return getDocument(userId, id)
})
