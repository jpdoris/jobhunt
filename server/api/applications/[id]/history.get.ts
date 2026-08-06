import { listHistory } from '../../../utils/history'
import { requireUserId } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  return listHistory(userId, id)
})
