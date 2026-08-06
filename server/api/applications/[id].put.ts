import { useDatabase } from '../../database'
import { getApplication } from '../../utils/applications'
import { requireUserId } from '../../utils/session'
import { ApplicationInput, parseOr400 } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const input = parseOr400(ApplicationInput, await readBody(event))

  // The user_id predicate is what stops one user editing another's row; without
  // it this would happily update any id. Changing status_id here fires the
  // status_event trigger — never insert history by hand.
  const { changes } = useDatabase()
    .prepare(
      `UPDATE application SET
         company = @company, role = @role, description = @description,
         job_posting_link = @jobPostingLink, contact = @contact,
         apply_date = @applyDate,
         -- Set before status_id in the same statement so the trigger sees it.
         status_changed_at = @statusChangedAt, status_id = @statusId,
         next_step_id = @nextStepId, next_step_date_time = @nextStepDateTime,
         notes = @notes, submitted_to_unemployment = @submittedToUnemployment
       WHERE id = @id AND user_id = @userId`,
    )
    .run({
      id,
      userId,
      ...input,
      // Null means "now" — the trigger's COALESCE fills it in.
      statusChangedAt: input.statusChangedAt ?? null,
      submittedToUnemployment: Number(input.submittedToUnemployment),
    })

  if (!changes) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return getApplication(userId, id)
}) 
