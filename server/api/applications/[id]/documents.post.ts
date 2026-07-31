import { z } from 'zod'
import { attachDocument, documentsForApplication } from '../../../utils/documents'
import { requireUserId } from '../../../utils/session'
import { parseOr400 } from '../../../utils/validation'

const Body = z.object({ documentId: z.coerce.number().int().positive() })

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const { documentId } = parseOr400(Body, await readBody(event))
  // Fails when either side belongs to someone else, so a guessed id gets a 404
  // rather than a cross-user attachment.
  if (!attachDocument(userId, id, documentId)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return documentsForApplication(userId, id)
})
