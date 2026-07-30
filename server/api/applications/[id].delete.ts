import { useDatabase } from '../../database'
import { requireUserId } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const { changes } = useDatabase()
    .prepare('DELETE FROM application WHERE id = ? AND user_id = ?')
    .run(id, userId)

  if (!changes) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return { ok: true }
})
