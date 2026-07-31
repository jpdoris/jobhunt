import { createReadStream, existsSync } from 'node:fs'
import { getDocument, resolveStoredFile } from '../../../utils/documents'
import { requireUserId } from '../../../utils/session'

/**
 * Streams the stored file back.
 *
 * Ownership is checked before the path is ever resolved — without that, an id
 * from the URL would let any signed-in user read any other user's résumé.
 * resolveStoredFile() then refuses anything outside data/documents/.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const doc = getDocument(userId, id)
  if (!doc?.filePath) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const full = resolveStoredFile(doc.filePath)
  if (!existsSync(full)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File missing',
      message: 'The record exists but its file is gone from disk.',
    })
  }

  const extension = doc.filePath.slice(doc.filePath.lastIndexOf('.'))
  const safeName = `${doc.title.replace(/[^\w.\- ]+/g, '_')}${extension}`

  setResponseHeaders(event, {
    'Content-Type': doc.mimeType ?? 'application/octet-stream',
    // inline so PDFs preview in the browser; the filename still applies on save.
    'Content-Disposition': `inline; filename="${safeName}"`,
    'Content-Length': String(doc.byteSize ?? 0),
    // Never let a proxy or the browser cache one user's document.
    'Cache-Control': 'private, no-store',
  })

  return sendStream(event, createReadStream(full))
})
