<script setup lang="ts">
import type { Application } from '#shared/types'
import { googleCalendarUrl } from '#shared/calendar'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()

const { data } = await useFetch('/api/applications')

const scheduled = computed<Application[]>(() =>
  (data.value?.applications ?? []).filter((a) => a.nextStepDateTime),
)

/* Which month ------------------------------------------------------------- */

/** In the URL like the filters and sort, so a month is linkable. */
const monthStart = computed(() => {
  const match = /^(\d{4})-(\d{2})$/.exec((route.query.month as string) ?? '')
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, 1)
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
})

const monthLabel = computed(() =>
  monthStart.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
)

function goMonth(delta: number) {
  const d = new Date(monthStart.value)
  d.setMonth(d.getMonth() + delta)
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  router.push({ query: { ...route.query, month } })
}

function goToday() {
  const { month: _drop, ...rest } = route.query
  router.push({ query: rest })
}

/* Grid -------------------------------------------------------------------- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Whole Sunday–Saturday rows covering the month, and no further. */
const weeks = computed(() => {
  const first = monthStart.value
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)

  const cursor = new Date(first)
  cursor.setDate(1 - first.getDay())

  const rows: Date[][] = []
  for (;;) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    rows.push(week)
    // Stop as soon as the month is covered, rather than always drawing six rows
    // and leaving a blank one.
    if (week[6]! >= last) break
  }
  return rows
})

const eventsByDay = computed(() => {
  const map = new Map<string, Application[]>()
  for (const a of scheduled.value) {
    const key = localDayKey(a.nextStepDateTime!)
    const list = map.get(key)
    if (list) list.push(a)
    else map.set(key, [a])
  }
  for (const list of map.values()) {
    list.sort((x, y) => (x.nextStepDateTime! < y.nextStepDateTime! ? -1 : 1))
  }
  return map
})

const todayKey = dayKey(new Date())
const eventsOn = (day: Date) => eventsByDay.value.get(dayKey(day)) ?? []
const inMonth = (day: Date) => day.getMonth() === monthStart.value.getMonth()

/* Upcoming ---------------------------------------------------------------- */

const upcoming = computed(() => {
  // Stored values are UTC, so compare against a UTC stamp in the same shape.
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ')
  return scheduled.value
    .filter((a) => a.nextStepDateTime! >= nowUtc)
    .sort((a, b) => (a.nextStepDateTime! < b.nextStepDateTime! ? -1 : 1))
    .slice(0, 8)
})
</script>

<template>
  <div>
    <AppNav />

    <main class="page">
      <div class="page-head">
        <div>
          <h1 class="page-head__title">Calendar</h1>
          <p class="page-head__sub text-muted">
            {{ scheduled.length }} scheduled next step{{ scheduled.length === 1 ? '' : 's' }}
          </p>
        </div>
        <div class="cluster">
          <button class="btn btn-secondary" aria-label="Previous month" @click="goMonth(-1)">←</button>
          <span class="cal__label">{{ monthLabel }}</span>
          <button class="btn btn-secondary" aria-label="Next month" @click="goMonth(1)">→</button>
          <button class="btn btn-ghost" @click="goToday">Today</button>
        </div>
      </div>

      <p v-if="!scheduled.length" class="empty text-muted">
        Nothing scheduled yet. Give an application a
        <strong>next step date &amp; time</strong> and it will appear here.
      </p>

      <div class="table-scroll">
        <table class="cal">
          <caption class="visually-hidden">{{ monthLabel }} — next steps by day</caption>
          <thead>
            <tr>
              <th v-for="d in WEEKDAYS" :key="d" scope="col">{{ d }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(week, wi) in weeks" :key="wi">
              <td
                v-for="day in week"
                :key="day.toISOString()"
                class="cal__day"
                :class="{
                  'cal__day--outside': !inMonth(day),
                  'cal__day--today': dayKey(day) === todayKey,
                }"
              >
                <span class="cal__date">{{ day.getDate() }}</span>
                <NuxtLink
                  v-for="a in eventsOn(day)"
                  :key="a.id"
                  class="cal__event"
                  :to="`/applications/${a.id}`"
                  :title="`${a.company} — ${a.nextStepLabel}`"
                >
                  <span class="cal__event-time">{{ formatTimeOnly(a.nextStepDateTime!) }}</span>
                  {{ a.company }}
                </NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="upcoming.length" class="section cal__upcoming">
        <h2 class="section__title">Upcoming</h2>
        <ul class="cal__list">
          <li v-for="a in upcoming" :key="a.id">
            <NuxtLink :to="`/applications/${a.id}`">{{ a.company }}</NuxtLink>
            <span class="text-muted">{{ a.nextStepLabel }}</span>
            <span class="cell--tight text-muted">{{ formatInstant(a.nextStepDateTime) }}</span>
            <a
              class="btn btn-ghost cal__add"
              :href="googleCalendarUrl(a)!"
              target="_blank"
              rel="noopener"
              :aria-label="`Add ${a.company} to Google Calendar`"
            >
              <AppIcon name="calendar" />
            </a>
          </li>
        </ul>
      </div>
    </main>
  </div>
</template>

<style scoped>
.cal__label {
  font-family: var(--font-heading);
  font-weight: var(--font-heading-weight);
  font-size: var(--text-lg);
  min-width: 9ch;
  text-align: center;
}

.cal {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  /* Below this the day cells stop being usable, so scroll instead of squashing. */
  min-width: 700px;
}

.cal th {
  text-align: left;
  font-size: var(--text-xs);
  letter-spacing: var(--tracking-th);
  text-transform: uppercase;
  color: var(--ink-th);
  padding: var(--space-2);
  border-bottom: var(--rule);
}

.cal__day {
  vertical-align: top;
  height: 110px;
  padding: var(--space-1);
  border: var(--hairline);
}

.cal__day--outside {
  background: var(--wash-row);
}

.cal__day--outside .cal__date {
  color: var(--ink-muted);
}

/* Inset so the ring sits inside the cell border instead of straddling it. */
.cal__day--today {
  outline: var(--rule-accent);
  outline-offset: -2px;
}

.cal__date {
  display: block;
  font-size: var(--text-sm);
  margin-bottom: var(--space-1);
}

.cal__event {
  display: block;
  font-size: var(--text-xs);
  line-height: 1.3;
  padding: 2px var(--space-1);
  margin-bottom: 2px;
  background: var(--color-accent-100);
  color: var(--color-accent-800);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal__event:hover {
  background: var(--color-accent);
  color: var(--color-bg);
}

.cal__event-time {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.cal__upcoming {
  margin-top: var(--space-6);
}

.cal__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cal__add {
  margin-left: auto;
}

.cal__list li {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  padding-bottom: var(--space-2);
  border-bottom: var(--hairline);
}
</style>
