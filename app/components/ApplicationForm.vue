<script setup lang="ts">
import type { Application, NextStepOption, StatusOption } from '#shared/types'

const props = defineProps<{
  statuses: StatusOption[]
  nextSteps: NextStepOption[]
  application?: Application | null
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const backdrop = useBackdropDismiss(() => emit('close'))

const editing = computed(() => Boolean(props.application))
const originalStatusId = props.application?.statusId ?? null

/** Only meaningful when the status actually moves. */
const statusChanged = computed(() => editing.value && form.statusId !== originalStatusId)
const error = ref('')
const pending = ref(false)

const form = reactive({
  company: props.application?.company ?? '',
  role: props.application?.role ?? '',
  statusId: props.application?.statusId ?? props.statuses[0]?.id ?? 0,
  nextStepId:
    props.application?.nextStepId ??
    props.nextSteps.find((n) => n.label === 'Awaiting response')?.id ??
    props.nextSteps[0]?.id ??
    0,
  nextStepLocal: utcToLocalInput(props.application?.nextStepDateTime ?? null),
  statusChangedLocal: '',
  applyDate: props.application?.applyDate ?? '',
  jobPostingLink: props.application?.jobPostingLink ?? '',
  contact: props.application?.contact ?? '',
  submittedToUnemployment: props.application?.submittedToUnemployment ?? false,
  description: props.application?.description ?? '',
  notes: props.application?.notes ?? '',
})

/* Closing an application closes out its next step ------------------------- */

/** Both flags, never labels — CLAUDE.md rule 3. */
const closed = computed(
  () => props.statuses.find((s) => s.id === form.statusId)?.isTerminal ?? false,
)
const noneStep = computed(() => props.nextSteps.find((n) => n.isNone) ?? null)

/**
 * The server applies this on save regardless (closedNextStepSql). Mirroring it
 * here means the user sees the next step close out as they pick the status,
 * rather than finding it changed underneath them afterwards. Immediate, so
 * editing an already-closed application shows the same thing.
 */
watch(
  closed,
  (isClosed) => {
    if (!isClosed) return
    if (noneStep.value) form.nextStepId = noneStep.value.id
    form.nextStepLocal = ''
  },
  { immediate: true },
)

async function save() {
  error.value = ''
  pending.value = true
  try {
    const body = {
      company: form.company,
      role: form.role,
      statusId: form.statusId,
      nextStepId: form.nextStepId,
      // Omitted unless the status moved and a time was given — the trigger then
      // stamps "now" as usual.
      statusChangedAt:
        statusChanged.value && form.statusChangedLocal
          ? localInputToUtc(form.statusChangedLocal)
          : undefined,
      // Converted from the viewer's zone to UTC here, at the edge.
      nextStepDateTime: localInputToUtc(form.nextStepLocal),
      applyDate: form.applyDate,
      jobPostingLink: form.jobPostingLink,
      contact: form.contact,
      submittedToUnemployment: form.submittedToUnemployment,
      description: form.description,
      notes: form.notes,
    }
    if (editing.value) {
      await $fetch(`/api/applications/${props.application!.id}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/applications', { method: 'POST', body })
    }
    emit('saved')
  } catch (e) {
    error.value = (e as { data?: { message?: string } }).data?.message ?? 'Could not save.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="dialog-backdrop" v-on="backdrop">
    <form class="dialog" @submit.prevent="save">
      <div class="dialog-title">{{ editing ? 'Edit application' : 'New application' }}</div>

      <div class="form-grid">
        <div class="field">
          <label for="company">Company</label>
          <input id="company" v-model="form.company" class="input" placeholder="Company name" required />
        </div>
        <div class="field">
          <label for="role">Role</label>
          <input id="role" v-model="form.role" class="input" placeholder="Job title" />
        </div>

        <div class="field">
          <label for="applyDate">Applied on</label>
          <input id="applyDate" v-model="form.applyDate" class="input" type="date" />
        </div>
        <div class="field">
          <label for="statusId">Status</label>
          <select id="statusId" v-model.number="form.statusId" class="input">
            <option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>

        <div v-if="statusChanged" class="field form-grid__wide">
          <label for="statusChangedLocal">When did the status change?</label>
          <input
            id="statusChangedLocal"
            v-model="form.statusChangedLocal"
            class="input"
            type="datetime-local"
          />
          <p class="field__hint text-muted">
            Leave blank for now. Set it to record a change that happened earlier —
            response-time analytics read these dates.
          </p>
        </div>

        <div class="field">
          <label for="nextStepId">Next step</label>
          <select
            id="nextStepId"
            v-model.number="form.nextStepId"
            class="input"
            :disabled="closed"
          >
            <option v-for="n in nextSteps" :key="n.id" :value="n.id">{{ n.label }}</option>
          </select>
        </div>
        <div class="field">
          <label for="nextStepLocal">Next step date &amp; time</label>
          <input
            id="nextStepLocal"
            v-model="form.nextStepLocal"
            class="input"
            type="datetime-local"
            :disabled="closed"
          />
        </div>
        <p v-if="closed" class="field__hint form-grid__wide text-muted">
          This status closes the application, so its next step is
          {{ noneStep?.label ?? 'cleared' }} and any date is dropped.
        </p>

        <div class="field form-grid__wide">
          <label for="jobPostingLink">Job posting link</label>
          <input id="jobPostingLink" v-model="form.jobPostingLink" class="input" type="url" placeholder="https://…" />
        </div>

        <div class="field">
          <label for="contact">Recruiter email</label>
          <input id="contact" v-model="form.contact" class="input" type="email" placeholder="Optional" />
        </div>
        <div class="field form-grid__end">
          <label class="radio">
            <input v-model="form.submittedToUnemployment" type="checkbox" />
            <span class="dot" />
            Filed with unemployment
          </label>
        </div>

        <div class="field form-grid__wide">
          <label for="description">Description</label>
          <textarea id="description" v-model="form.description" class="input" placeholder="Paste the job description" />
        </div>
        <div class="field form-grid__wide">
          <label for="notes">Notes</label>
          <textarea id="notes" v-model="form.notes" class="input" placeholder="Optional notes" />
        </div>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>

      <div class="dialog-actions">
        <button class="btn btn-secondary" type="button" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary" type="submit" :disabled="pending">
          {{ pending ? 'Saving…' : 'Save application' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.field__hint {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3) var(--space-4);
}

.form-grid__wide {
  grid-column: span 2;
}

.form-grid__end {
  align-self: end;
  padding-bottom: var(--baseline-nudge);
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
