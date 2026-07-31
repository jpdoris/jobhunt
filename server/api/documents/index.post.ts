import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MAX_UPLOAD_BYTES } from '#shared/types'
import { useDatabase } from '../../database'
import { createDocument, documentsDir, getDocument } from '../../utils/documents'
import { ACCEPTED_MIME, extractText, isAcceptedMime } from '../../utils/extract-text'
import { requireUserId } from '../../utils/session'

/**
 * Multipart upload. Returns the created document plus an `extraction` note so
 * the UI can tell the user when a file stored fine but yielded no searchable
 * text (a scanned PDF, typically) rather than failing silently.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, statusMessage: 'No upload received' })

  const field = (name: string) =>
    parts.find((p) => p.name === name && !p.filename)?.data.toString('utf8').trim()
  const file = parts.find((p) => p.filename)

  const kindId = Number(field('kindId'))
  if (!Number.isInteger(kindId) || kindId < 1) {
    throw createError({ statusCode: 400, statusMessage: 'kindId is required' })
  }

  const pastedText = field('contentText') || ''
  let title = field('title') || ''

  let filePath: string | null = null
  let mimeType: string | null = null
  let byteSize: number | null = null
  let contentText = pastedText
  let extraction: { extracted: boolean; note?: string } = { extracted: Boolean(pastedText) }

  if (file) {
    mimeType = file.type ?? ''
    if (!isAcceptedMime(mimeType)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported file type',
        message: `Accepted types: PDF, DOCX, TXT, MD. Received ${mimeType || 'unknown'}.`,
      })
    }
    if (file.data.length > MAX_UPLOAD_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: 'File too large',
        message: `Limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      })
    }

    byteSize = file.data.length
    if (!title) title = (file.filename ?? 'Untitled').replace(/\.[^.]+$/, '')

    // Only ever paste text if extraction found none — never overwrite a real
    // extraction with an empty box.
    if (!contentText) {
      const result = await extractText(file.data, mimeType)
      contentText = result.text
      extraction = { extracted: result.extracted, note: result.note }
    }
  }

  if (!title) throw createError({ statusCode: 400, statusMessage: 'A title or a file is required' })
  if (!file && !contentText) {
    throw createError({ statusCode: 400, statusMessage: 'Provide a file or some text' })
  }

  const id = createDocument({
    userId,
    kindId,
    title,
    filePath: null,
    mimeType,
    byteSize,
    contentText: contentText || null,
  })

  if (file) {
    // Named from the row id, never from the uploaded filename — a user-supplied
    // name is the classic path-traversal vector, and ids are already unique.
    filePath = `${id}${ACCEPTED_MIME[mimeType as keyof typeof ACCEPTED_MIME]}`
    writeFileSync(resolve(documentsDir(), filePath), file.data)
    useDatabase().prepare('UPDATE document SET file_path = ? WHERE id = ?').run(filePath, id)
  }

  setResponseStatus(event, 201)
  return { document: getDocument(userId, id), extraction }
})
