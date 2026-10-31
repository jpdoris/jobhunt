import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * createApplication and the document helpers go through the shared connection
 * (useDatabase), so point it at a fresh in-memory database built from
 * docs/schema.sql before anything opens it. Covers the write path that both the
 * create endpoint and scripts/add-application.ts use.
 */
process.env.JOBHUNT_DB_PATH = ':memory:'

const { useDatabase, closeDatabase } = await import('../server/database/index.ts')
const { createApplication, getApplication, listApplications, updateApplication } = await import(
  '../server/utils/applications.ts'
)
const { attachDocument, createDocument, documentsForApplication, listDocuments } = await import(
  '../server/utils/documents.ts'
)
const { ApplicationInput } = await import('../server/utils/validation.ts')

let ownerId: number
let otherId: number
let applied: number
let rejected: number
let screener: number
let none: number
let resume: number

beforeAll(() => {
  const db = useDatabase()
  db.exec(readFileSync(resolve(process.cwd(), 'docs/schema.sql'), 'utf8'))
  const user = (email: string) =>
    Number(db.prepare('INSERT INTO user (email, password_hash) VALUES (?, ?)').run(email, 'x').lastInsertRowid)
  ownerId = user('owner@test')
  otherId = user('other@test')
  const id = (table: string, label: string) =>
    (db.prepare(`SELECT id FROM ${table} WHERE label = ?`).get(label) as { id: number }).id
  applied = id('status', 'Applied')
  rejected = id('status', 'Rejected')
  screener = id('next_step', 'Screener call')
  none = (db.prepare('SELECT id FROM next_step WHERE is_none = 1').get() as { id: number }).id
  resume = id('document_kind', 'Resume')
})

afterAll(() => closeDatabase())

const input = (overrides: Record<string, unknown> = {}) =>
  ApplicationInput.parse({
    company: 'Acme',
    role: 'Frontend Engineer',
    statusId: applied,
    nextStepId: screener,
    ...overrides,
  })

describe('createApplication', () => {
  it('belongs to the given user and no one else', () => {
    const id = createApplication(ownerId, input())
    expect(getApplication(ownerId, id)?.company).toBe('Acme')
    expect(getApplication(otherId, id)).toBeNull()
    expect(listApplications(otherId).map((a) => a.id)).not.toContain(id)
  })

  it('stores the angle and makes it searchable', () => {
    const id = createApplication(ownerId, input({ angle: 'Design systems / UX engineer' }))
    expect(getApplication(ownerId, id)?.angle).toBe('Design systems / UX engineer')
    expect(listApplications(ownerId, { search: 'design systems' }).map((a) => a.id)).toContain(id)
    expect(listApplications(otherId, { search: 'design systems' })).toEqual([])
  })

  it('treats a missing angle as null', () => {
    const id = createApplication(ownerId, input())
    expect(getApplication(ownerId, id)?.angle).toBeNull()
  })

  it('stores the req id and makes it searchable, for its owner only', () => {
    const id = createApplication(ownerId, input({ jobReqId: ' R-2242 ' }))
    expect(getApplication(ownerId, id)?.jobReqId).toBe('R-2242')
    expect(listApplications(ownerId, { search: '2242' }).map((a) => a.id)).toContain(id)
    expect(listApplications(otherId, { search: '2242' })).toEqual([])
  })

  it('treats a blank req id as null', () => {
    const id = createApplication(ownerId, input({ jobReqId: '' }))
    expect(getApplication(ownerId, id)?.jobReqId).toBeNull()
  })

  it('closes out the next step when filed as already terminal', () => {
    const id = createApplication(
      ownerId,
      input({ statusId: rejected, nextStepDateTime: '2026-11-01 15:00:00' }),
    )
    const app = getApplication(ownerId, id)!
    expect(app.nextStepId).toBe(none)
    expect(app.nextStepDateTime).toBeNull()
  })

  it('records one status event, as any insert does', () => {
    const id = createApplication(ownerId, input())
    const n = useDatabase()
      .prepare('SELECT count(*) AS n FROM status_event WHERE application_id = ?')
      .get(id) as { n: number }
    expect(n.n).toBe(1)
  })
})

describe('updateApplication', () => {
  it('updates the owner\'s row', () => {
    const id = createApplication(ownerId, input())
    expect(updateApplication(ownerId, id, input({ jobReqId: '1693' }))).toBe(true)
    expect(getApplication(ownerId, id)?.jobReqId).toBe('1693')
  })

  it('refuses another user\'s row and leaves it untouched', () => {
    const id = createApplication(otherId, input())
    expect(updateApplication(ownerId, id, input({ company: 'Hijacked' }))).toBe(false)
    expect(getApplication(otherId, id)?.company).toBe('Acme')
  })

  it('closes out the next step when moved to a terminal status', () => {
    const id = createApplication(ownerId, input({ nextStepDateTime: '2026-11-01 15:00:00' }))
    updateApplication(ownerId, id, input({ statusId: rejected, nextStepDateTime: '2026-11-01 15:00:00' }))
    const app = getApplication(ownerId, id)!
    expect(app.nextStepId).toBe(none)
    expect(app.nextStepDateTime).toBeNull()
  })
})

describe('prefix search', () => {
  // Porter stemmed the typed prefix ("compsy" -> "compsi"), so a half-typed
  // name stopped matching partway through. Every prefix must match.
  it('matches every prefix of a company name as typed', () => {
    const id = createApplication(ownerId, input({ company: 'ComPsych' }))
    for (const typed of ['comp', 'comps', 'compsy', 'compsyc', 'ComPsych']) {
      expect(listApplications(ownerId, { search: typed }).map((a) => a.id), typed).toContain(id)
    }
  })

  it('matches a half-typed word in a document title', () => {
    const docId = createDocument({
      userId: ownerId,
      kindId: resume,
      title: 'ComPsych résumé',
      filePath: null,
      mimeType: 'text/plain',
      byteSize: 1,
      contentText: 'x',
    })
    expect(listDocuments(ownerId, { search: 'compsy' }).map((d) => d.id)).toContain(docId)
    expect(listDocuments(otherId, { search: 'compsy' })).toEqual([])
  })
})

describe('attaching documents', () => {
  const doc = (userId: number) =>
    createDocument({
      userId,
      kindId: resume,
      title: 'Résumé',
      filePath: null,
      mimeType: 'text/plain',
      byteSize: 1,
      contentText: 'x',
    })

  it('attaches the owner\'s document to the owner\'s application', () => {
    const appId = createApplication(ownerId, input())
    expect(attachDocument(ownerId, appId, doc(ownerId))).toBe(true)
    expect(documentsForApplication(ownerId, appId)).toHaveLength(1)
  })

  it('refuses another user\'s application', () => {
    const appId = createApplication(otherId, input())
    expect(attachDocument(ownerId, appId, doc(ownerId))).toBe(false)
  })

  it('refuses another user\'s document', () => {
    const appId = createApplication(ownerId, input())
    expect(attachDocument(ownerId, appId, doc(otherId))).toBe(false)
    expect(documentsForApplication(ownerId, appId)).toEqual([])
  })
})
