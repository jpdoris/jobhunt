<script setup lang="ts">
import { statusTagClass } from '#shared/types'
import type { StatusEvent, StatusOption } from '#shared/types'

/**
 * Edits an application's status history.
 *
 * Times are entered in the viewer's zone and stored UTC, same as every other
 * instant in the app. The server re-points the application at whatever event is
 * most recent after each change, so the badge on the page always agrees with
 * the timeline.
 */
const props = defineProps<{ applicationId: number; statuses: StatusOption[] }>()
const emit = defineEmits<{ changed: [] }>()

const { data: history, refresh } = await useFetch<StatusEvent[]>(
  () => `/api/applications/${props.applicationId}/history`,
)

const error = ref('')
const editingId = ref<number | null>(null)
const adding = ref(false)

const draft = reactive({ statusId: 0, local: '' })

function startEdit(e: StatusEvent) {
  adding.value = false
  editingId.value = e.id
  draft.statusId = e.statusId
  draft.local = utcToLocalInput(e.changedAt)
  error.value = ''
}

function startAdd() {
  editingId.value = null
  adding.value = true
  // Default to the current status, so the common case is one date away.
  draft.statusId = history.value?.at(-1)?.statusId ?? props.statuses[0]?.id ?? 0
  draft.local = utcToLocalInput(new Date().toISOString().slice(0, 19).replace('T', ' '))
  error.value = ''
}

function cancel() {
  editingId.value = null
  adding.value = false
  error.value = ''
}

async function save() {
  const changedAt = localInputToUtc(draft.local)
  if (!changedAt) {
    error.value = 'Pick a date and time.'
    return
  }
  const body = { statusId: draft.statusId, changedAt }
  try {
    if (adding.value) {
      await $fetch(`/api/applications/${props.applicationId}/history`, { method: 'POST', body })
    } else {
      await $fetch(`/api/applications/${props.applicationId}/history/${editingId.value}`, {
        method: 'PUT',
        body,
      })
    }
    cancel()
    await refresh()
    emit('changed')
  } catch (e) {
    error.value = (e as { data?: { message?: string } }).data?.message ?? 'Could not save.'
  }
}

async function remove(e: StatusEvent) {
  if (!confirm(`Delete the "${e.statusLabel}" entry from ${formatInstant(e.changedAt)}?`)) return
  await $fetch(`/api/applications/${props.applicationId}/history/${e.id}`, { method: 'DELETE' })
  await refresh()
  emit('changed')
}

/** Days between consecutive entries — the whole point of keeping history. */
function gapDays(index: number): number | null {
  const list = history.value ?? []
  if (index === 0) return null
  const a = new Date(`${list[index - 1]!.changedAt.replace(' ', 'T')}Z`).getTime()
  const b = new Date(`${list[index]!.changedAt.replace(' ', 'T')}Z`).getTime()
  return Math.round((b - a) / 86400000)
}
</script>

<template>
  <div>
    <ul v-if="history?.length" class="timeline">
      <li v-for="(e, i) in history" :key="e.id" class="timeline__row">
        <template v-if="editingId === e.id">
          <select v-model.number="draft.statusId" class="input timeline__status" aria-label="Status">
            <option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
          <input v-model="draft.local" class="input timeline__when" type="datetime-local" aria-label="When" />
          <button class="btn btn-secondary" @click="save">Save</button>
          <button class="btn btn-ghost" @click="cancel">Cancel</button>
        </template>
        <template v-else>
          <span class="tag" :class="statusTagClass(e)">{{ e.statusLabel }}</span>
          <span class="timeline__date">{{ formatInstant(e.changedAt) }}</span>
          <span v-if="gapDays(i) !== null" class="timeline__gap text-muted">
            +{{ gapDays(i) }}d
          </span>
          <span class="timeline__spacer" />
          <button class="btn btn-ghost" @click="startEdit(e)">Edit</button>
          <button class="btn btn-ghost" @click="remove(e)">Delete</button>
        </template>
      </li>
    </ul>

    <p v-else class="section__body text-muted">
      No history recorded. Add the dates you remember to make this application count
      toward response-time analytics.
    </p>

    <div v-if="adding" class="timeline__row timeline__add">
      <select v-model.number="draft.statusId" class="input timeline__status" aria-label="Status">
        <option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <input v-model="draft.local" class="input timeline__when" type="datetime-local" aria-label="When" />
      <button class="btn btn-secondary" @click="save">Add</button>
      <button class="btn btn-ghost" @click="cancel">Cancel</button>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>

    <button v-if="!adding" class="btn btn-ghost timeline__addbtn" @click="startAdd">
      <AppIcon name="plus" /> Add a status change
    </button>
  </div>
</template>

<style scoped>
.timeline {
  list-style: none;
  margin: 0 0 var(--space-2);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.timeline__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.timeline__spacer {
  margin-left: auto;
}

.timeline__date {
  font-size: var(--text-md);
}

.timeline__gap {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.timeline__status {
  width: auto;
  min-width: 200px;
}

.timeline__when {
  width: auto;
}

.timeline__add {
  padding-top: var(--space-2);
}

.timeline__addbtn {
  margin-top: var(--space-2);
}
</style>
