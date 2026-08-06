import { addEvent } from '../../../utils/history'
import { requireUserId } from '../../../utils/session'
import { HistoryEventInput, parseOr400 } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const input = parseOr400(HistoryEventInput, await readBody(event))
  const history = addEvent(userId, id, input)
  if (!history) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setResponseStatus(event, 201)
  return history
})
