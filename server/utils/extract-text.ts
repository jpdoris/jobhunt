/**
 * Pulls plain text out of an uploaded document so it can be indexed by
 * document_fts. Search reads `content_text`, never the file on disk.
 *
 * Extraction is best-effort by design: a scanned PDF is a stack of images with
 * no text layer, and no parser will find words in it. That is a real outcome,
 * not a failure — the document still stores and downloads. The caller surfaces
 * the empty result so the user can paste text instead of wondering why search
 * misses it (docs/PRD.md).
 */

export const ACCEPTED_MIME = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'text/markdown': '.md',
} as const

export type AcceptedMime = keyof typeof ACCEPTED_MIME

export function isAcceptedMime(mime: string): mime is AcceptedMime {
  return mime in ACCEPTED_MIME
}

export interface ExtractionResult {
  text: string
  /** False when the format is understood but yielded no words — e.g. a scan. */
  extracted: boolean
  note?: string
}

export async function extractText(buffer: Buffer, mime: string): Promise<ExtractionResult> {
  try {
    const text = await extractByType(buffer, mime)
    const cleaned = normalize(text)

    if (!cleaned) {
      return {
        text: '',
        extracted: false,
        note:
          mime === 'application/pdf'
            ? 'No text layer found — this looks like a scanned PDF. Paste the text to make it searchable.'
            : 'No text found in the file. Paste the text to make it searchable.',
      }
    }
    return { text: cleaned, extracted: true }
  } catch (error) {
    // A broken file should not lose the upload; store it and say so.
    return {
      text: '',
      extracted: false,
      note: `Could not read the file (${(error as Error).message}). Paste the text to make it searchable.`,
    }
  }
}

async function extractByType(buffer: Buffer, mime: string): Promise<string> {
  if (mime === 'application/pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await pdfText(pdf, { mergePages: true })
    return Array.isArray(text) ? text.join('\n') : text
  }

  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ buffer })
    return value
  }

  if (mime === 'text/plain' || mime === 'text/markdown') {
    return buffer.toString('utf8')
  }

  throw new Error(`Unsupported type ${mime}`)
}

/** PDFs in particular come out with ragged whitespace; FTS does not care but humans reading the paste box do. */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
