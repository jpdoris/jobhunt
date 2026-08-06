import { deleteEvent } from '../../../../utils/history'
import { requireUserId } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  const eventId = Number(getRouterParam(event, 'eventId'))
  if (!Number.isInteger(id) || !Number.isInteger(eventId)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }
  const history = deleteEvent(userId, id, eventId)
  if (!history) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return history
})
