<script setup lang="ts">
import { statusTagClass } from '#shared/types'
import type { Application, StatusCount } from '#shared/types'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()

/** Filter state lives in the URL so views are bookmarkable (docs/PRD.md). */
const filters = computed(() => ({
  search: (route.query.search as string) || undefined,
  statusId: route.query.statusId ? Number(route.query.statusId) : undefined,
  nextStepId: route.query.nextStepId ? Number(route.query.nextStepId) : undefined,
  appliedFrom: (route.query.appliedFrom as string) || undefined,
  appliedTo: (route.query.appliedTo as string) || undefined,
  submittedToUnemployment: route.query.filed === '1' ? true : undefined,
}))

const { data, refresh } = await useFetch('/api/applications', { query: filters })
const { data: lookups } = await useFetch('/api/lookups')

const applications = computed<Application[]>(() => data.value?.applications ?? [])
const counts = computed<StatusCount[]>(() => data.value?.counts ?? [])

function setQuery(patch: Record<string, string | undefined>) {
  const query = { ...route.query, ...patch }
  for (const [k, v] of Object.entries(query)) if (!v) delete query[k]
  router.push({ query })
}

const search = ref((route.query.search as string) ?? '')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setQuery({ search: v || undefined }), 250)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const hasFilters = computed(() => Object.keys(route.query).length > 0)

function toggleStatus(statusId: number) {
  setQuery({ statusId: filters.value.statusId === statusId ? undefined : String(statusId) })
}

function exportCsv() {
  const header = [
    'company', 'role', 'status', 'next_step', 'next_step_date_time',
    'apply_date', 'job_posting_link', 'contact', 'submitted_to_unemployment', 'notes',
  ]
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    header.join(','),
    // Exports the current filtered view, not the whole table (docs/PRD.md).
    ...applications.value.map((a) =>
      [
        a.company, a.role, a.statusLabel, a.nextStepLabel, a.nextStepDateTime,
        a.applyDate, a.jobPostingLink, a.contact, a.submittedToUnemployment ? 1 : 0, a.notes,
      ]
        .map(escape)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `applications-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

const showForm = ref(false)

async function onSaved() {
  showForm.value = false
  await refresh()
}
</script>

<template>
  <div>
    <AppNav show-actions @export="exportCsv" />

    <main class="page">
      <div class="page-head">
        <div>
          <h1 class="page-head__title">Applications</h1>
          <p class="page-head__sub text-muted">{{ applications.length }} tracked applications</p>
        </div>
        <button class="btn btn-primary" @click="showForm = true">
          <AppIcon name="plus" /> New application
        </button>
      </div>

      <div class="stat-grid">
        <button
          v-for="tile in counts"
          :key="tile.statusId"
          class="card card--button"
          :class="{
            'card--selected': filters.statusId === tile.statusId,
            'card--zero': tile.count === 0,
          }"
          :aria-pressed="filters.statusId === tile.statusId"
          @click="toggleStatus(tile.statusId)"
        >
          <span class="card-kicker">{{ tile.label }}</span>
          <span class="card-title">{{ tile.count }}</span>
        </button>
      </div>

      <div class="filter-bar">
        <div class="field field--grow">
          <label for="search">Search</label>
          <div class="input-icon">
            <span class="input-icon__glyph"><AppIcon name="search" /></span>
            <input
              id="search"
              v-model="search"
              class="input"
              placeholder="Company, role, description…"
            />
          </div>
        </div>

        <div class="field field--md">
          <label for="status">Status</label>
          <select
            id="status"
            class="input"
            :value="route.query.statusId ?? ''"
            @change="setQuery({ statusId: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">All statuses</option>
            <option v-for="s in lookups?.statuses ?? []" :key="s.id" :value="s.id">
              {{ s.label }}
            </option>
          </select>
        </div>

        <div class="field field--md">
          <label for="nextStep">Next step</label>
          <select
            id="nextStep"
            class="input"
            :value="route.query.nextStepId ?? ''"
            @change="setQuery({ nextStepId: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">All</option>
            <option v-for="n in lookups?.nextSteps ?? []" :key="n.id" :value="n.id">
              {{ n.label }}
            </option>
          </select>
        </div>

        <div class="field field--sm">
          <label for="from">Applied from</label>
          <input
            id="from"
            class="input"
            type="date"
            :value="route.query.appliedFrom ?? ''"
            @change="setQuery({ appliedFrom: ($event.target as HTMLInputElement).value || undefined })"
          />
        </div>

        <div class="field field--sm">
          <label for="to">Applied to</label>
          <input
            id="to"
            class="input"
            type="date"
            :value="route.query.appliedTo ?? ''"
            @change="setQuery({ appliedTo: ($event.target as HTMLInputElement).value || undefined })"
          />
        </div>

        <label class="radio field--inline">
          <input
            type="checkbox"
            :checked="route.query.filed === '1'"
            @change="setQuery({ filed: ($event.target as HTMLInputElement).checked ? '1' : undefined })"
          />
          <span class="dot" />
          Filed
        </label>

        <button v-if="hasFilters" class="btn btn-ghost" @click="router.push({ query: {} })">
          Clear filters
        </button>
      </div>

      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Status</th>
              <th>Next step</th>
              <th>When</th>
              <th>Applied</th>
              <th>Unemployment</th>
              <th><span class="visually-hidden">Posting</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in applications"
              :key="a.id"
              class="row--clickable"
              @click="navigateTo(`/applications/${a.id}`)"
            >
              <td class="cell--wrap">{{ a.company }}</td>
              <td class="cell--wrap">{{ a.role ?? '—' }}</td>
              <td>
                <span class="tag" :class="statusTagClass(a)">{{ a.statusLabel }}</span>
              </td>
              <td>{{ a.nextStepLabel }}</td>
              <td class="cell--tight">{{ formatInstant(a.nextStepDateTime) }}</td>
              <td class="cell--tight">{{ formatApplyDate(a.applyDate) }}</td>
              <td>
                <span v-if="a.submittedToUnemployment" class="tag tag-outline">Filed</span>
              </td>
              <td>
                <a
                  v-if="a.jobPostingLink"
                  class="btn btn-ghost btn-icon"
                  :href="a.jobPostingLink"
                  target="_blank"
                  rel="noopener"
                  title="Open posting"
                  aria-label="Open posting"
                  @click.stop
                >
                  <AppIcon name="ext" />
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!applications.length" class="empty text-muted">
        No applications match these filters.
      </p>
      <p v-else class="meta-note text-muted">Showing {{ applications.length }} applications</p>
    </main>

    <ApplicationForm
      v-if="showForm"
      :statuses="lookups?.statuses ?? []"
      :next-steps="lookups?.nextSteps ?? []"
      @close="showForm = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}

/* Tiles are buttons that filter by status, so they need the button reset. */
.card--button {
  border: 0;
  border-top: var(--rule-accent);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.card--button:hover {
  background: var(--wash-text);
}

.card--selected {
  outline: var(--focus-ring);
  outline-offset: -2px;
}

.card--zero .card-title {
  color: var(--ink-muted);
}

.filter-bar {
  display: flex;
  gap: var(--space-3);
  align-items: flex-end;
  flex-wrap: wrap;
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-2);
  border-bottom: var(--rule);
}

.field--grow {
  min-width: 220px;
  flex: 1;
}

.field--md {
  width: 170px;
}

.field--sm {
  width: 150px;
}

.field--inline {
  padding-bottom: var(--baseline-nudge);
}

.input-icon {
  position: relative;
}

.input-icon__glyph {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.55;
  pointer-events: none;
}

.input-icon .input {
  padding-left: 30px;
}

.cell--wrap {
  min-width: 180px;
}

.meta-note {
  margin-top: var(--space-3);
  font-size: var(--text-base);
}
</style>
