import { nextSteps, statuses } from '../utils/applications'
import { requireUserId } from '../utils/session'

export default defineEventHandler(async (event) => {
  await requireUserId(event)
  // Vocabularies are global and read-only (docs/PRD.md) — no user scoping, and
  // nothing here ever writes.
  return { statuses: statuses(), nextSteps: nextSteps() }
})
