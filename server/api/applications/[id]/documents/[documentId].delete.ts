import { detachDocument, documentsForApplication } from '../../../../utils/documents'
import { requireUserId } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  const documentId = Number(getRouterParam(event, 'documentId'))
  if (!Number.isInteger(id) || !Number.isInteger(documentId)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }

  // Detaching never deletes the document itself (docs/PRD.md).
  if (!detachDocument(userId, id, documentId)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  return documentsForApplication(userId, id)
})
