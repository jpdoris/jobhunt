import { updateEvent } from '../../../../utils/history'
import { requireUserId } from '../../../../utils/session'
import { HistoryEventInput, parseOr400 } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  const eventId = Number(getRouterParam(event, 'eventId'))
  if (!Number.isInteger(id) || !Number.isInteger(eventId)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }
  const input = parseOr400(HistoryEventInput, await readBody(event))
  const history = updateEvent(userId, id, eventId, input)
  if (!history) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return history
})
