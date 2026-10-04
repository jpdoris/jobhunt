<script setup lang="ts">
import { DEFAULT_SORT, FIRST_CLICK_DIRECTION, MILESTONE_LABELS, statusTagClass } from '#shared/types'
import type {
  Application,
  Milestone,
  MilestoneCounts,
  SortColumn,
  SortDirection,
  StatusCount,
} from '#shared/types'

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
  milestone: (route.query.milestone as Milestone) || undefined,
  sort: (route.query.sort as SortColumn) || undefined,
  dir: (route.query.dir as SortDirection) || undefined,
}))

/** Sort lives in the URL alongside the filters, so a sorted view is bookmarkable. */
const sort = computed(() => ({
  column: (route.query.sort as SortColumn) ?? DEFAULT_SORT.column,
  direction: (route.query.dir as SortDirection) ?? DEFAULT_SORT.direction,
}))

function toggleSort(column: SortColumn) {
  // Same column flips direction; a new column starts in whichever direction is
  // most useful for its type (newest-first for dates, A-Z for text).
  const direction: SortDirection =
    sort.value.column === column
      ? sort.value.direction === 'asc'
        ? 'desc'
        : 'asc'
      : FIRST_CLICK_DIRECTION[column]

  const isDefault = column === DEFAULT_SORT.column && direction === DEFAULT_SORT.direction
  setQuery({
    sort: isDefault ? undefined : column,
    dir: isDefault ? undefined : direction,
  })
}

const ariaSort = (column: SortColumn) =>
  sort.value.column === column
    ? sort.value.direction === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'

const sortArrow = (column: SortColumn) =>
  sort.value.column === column ? (sort.value.direction === 'asc' ? '↑' : '↓') : ''

const { data, refresh } = await useFetch('/api/applications', { query: filters })
const { data: lookups } = await useFetch('/api/lookups')

const applications = computed<Application[]>(() => data.value?.applications ?? [])
const counts = computed<StatusCount[]>(() => data.value?.counts ?? [])
const milestones = computed<MilestoneCounts | null>(() => data.value?.milestones ?? null)

/** Order runs journey-first (how far it got), then present state. */
const MILESTONE_ORDER: Milestone[] = ['interviewed', 'offered', 'open', 'closedNoOffer']

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

function toggleMilestone(milestone: Milestone) {
  setQuery({ milestone: filters.value.milestone === milestone ? undefined : milestone })
}

function exportCsv() {
  // `id` first so a re-import has a stable key to match on — company+role is
  // not unique, since re-applying to the same role is normal. The long free
  // text goes last, so the scannable columns stay to the left in a spreadsheet.
  const header = [
    'id', 'company', 'role', 'status', 'next_step', 'next_step_date_time',
    'apply_date', 'job_posting_link', 'contact', 'submitted_to_unemployment',
    'angle', 'description', 'notes',
  ]
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    // Descriptions are pasted job postings: they carry commas, quotes and hard
    // line breaks, so quote on CR as well as LF per RFC 4180.
    return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    header.join(','),
    // Exports the current filtered view, not the whole table (docs/PRD.md).
    ...applications.value.map((a) =>
      [
        a.id, a.company, a.role, a.statusLabel, a.nextStepLabel, a.nextStepDateTime,
        a.applyDate, a.jobPostingLink, a.contact, a.submittedToUnemployment ? 1 : 0,
        a.angle, a.description, a.notes,
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

      <!-- How far applications ever got. Distinct from the Status tiles below,
           which only ever describe where an application sits right now. -->
      <section v-if="milestones" class="section">
        <h2 class="visually-hidden">Overview</h2>
        <div class="stat-grid">
          <button
            class="card card--button"
            :class="{ 'card--selected': !filters.milestone }"
            :aria-pressed="!filters.milestone"
            @click="setQuery({ milestone: undefined })"
          >
            <span class="card-kicker">Total</span>
            <span class="card-title">{{ milestones.total }}</span>
          </button>
          <button
            v-for="m in MILESTONE_ORDER"
            :key="m"
            class="card card--button"
            :class="{
              'card--selected': filters.milestone === m,
              'card--zero': milestones[m] === 0,
            }"
            :aria-pressed="filters.milestone === m"
            @click="toggleMilestone(m)"
          >
            <span class="card-kicker">{{ MILESTONE_LABELS[m] }}</span>
            <span class="card-title">{{ milestones[m] }}</span>
          </button>
        </div>
        <!-- Said once here rather than as three hover targets: the overlap is
             the part that surprises people. -->
        <p class="overview-note text-muted">
          Interviewed and Offers count every application that ever reached that
          point, including ones since closed — so these overlap and do not sum
          to the total.
        </p>
      </section>

      <h2 class="section__title">Status</h2>
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

        <!-- The bubble sits outside the label on purpose: inside it, its text
             would be folded into the checkbox's accessible name. -->
        <div class="tooltip field--inline">
          <label class="radio">
            <input
              type="checkbox"
              aria-describedby="filed-filter-help"
              :checked="route.query.filed === '1'"
              @change="setQuery({ filed: ($event.target as HTMLInputElement).checked ? '1' : undefined })"
            />
            <span class="dot" />
            Filed
          </label>
          <!-- --end: this sits at the right of the filter bar, so the bubble
               grows leftward instead of off screen. -->
          <span id="filed-filter-help" role="tooltip" class="tooltip__bubble tooltip__bubble--end">
            Submitted with unemployment claim
          </span>
        </div>

        <button v-if="hasFilters" class="btn btn-ghost" @click="router.push({ query: {} })">
          Clear filters
        </button>
      </div>

      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th
                v-for="col in [
                  { key: 'company', label: 'Company' },
                  { key: 'role', label: 'Role' },
                  { key: 'status', label: 'Status' },
                  { key: 'nextStep', label: 'Next step' },
                  { key: 'when', label: 'When' },
                  { key: 'applied', label: 'Applied' },
                ] as { key: SortColumn; label: string }[]"
                :key="col.key"
                :aria-sort="ariaSort(col.key)"
              >
                <button class="th-sort" type="button" @click="toggleSort(col.key)">
                  {{ col.label }}
                  <span class="th-sort__arrow" aria-hidden="true">{{ sortArrow(col.key) }}</span>
                </button>
              </th>
              <!-- --below because .table-scroll clips anything above its top
                   edge; --end because this column sits near the right. -->
              <th :aria-sort="ariaSort('filed')" aria-describedby="filed-column-help">
                <span class="tooltip">
                  <button class="th-sort" type="button" @click="toggleSort('filed')">
                    Filed
                    <span class="th-sort__arrow" aria-hidden="true">{{ sortArrow('filed') }}</span>
                  </button>
                  <span
                    id="filed-column-help"
                    role="tooltip"
                    class="tooltip__bubble tooltip__bubble--below tooltip__bubble--end"
                  >
                    Submitted with unemployment claim
                  </span>
                </span>
              </th>
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
/* Both card sections share the grid, so their columns line up with each other. */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}

/* Inside .section the wrapper already carries the bottom margin. */
.section .stat-grid {
  margin-bottom: 0;
}

.overview-note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-base);
  max-width: var(--measure-narrow);
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
