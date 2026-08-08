<script setup lang="ts">
import type { Analytics } from '#shared/types'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()

const stalledAfter = computed(() => Number(route.query.stalledAfter) || 30)
const { data } = await useFetch<Analytics>('/api/analytics', {
  query: computed(() => ({ stalledAfter: stalledAfter.value })),
})

/** Bars are proportional to the largest value, not to the total. */
const maxStatus = computed(() => Math.max(1, ...(data.value?.byStatus ?? []).map((s) => s.count)))
const maxMonth = computed(() => Math.max(1, ...(data.value?.perMonth ?? []).map((m) => m.count)))

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)
</script>

<template>
  <div v-if="data">
    <AppNav />

    <main class="page">
      <div class="page-head">
        <div>
          <h1 class="page-head__title">Analytics</h1>
          <p class="page-head__sub text-muted">
            {{ data.total }} applications since {{ monthLabel(data.perMonth[0]?.month ?? '') }}
          </p>
        </div>
      </div>

      <!-- Counts cover every application; durations below do not. -->
      <div class="kpis">
        <div class="card">
          <span class="card-kicker">Total</span>
          <span class="card-title">{{ data.total }}</span>
        </div>
        <div class="card">
          <span class="card-kicker">Still live</span>
          <span class="card-title">{{ data.live }}</span>
          <span class="kpi__note text-muted">{{ pct(data.live, data.total) }}% of all</span>
        </div>
        <div class="card">
          <span class="card-kicker">Ended</span>
          <span class="card-title">{{ data.ended }}</span>
          <span class="kpi__note text-muted">{{ pct(data.ended, data.total) }}% of all</span>
        </div>
        <!-- History OR current status, so rows imported without transition
             dates still count. -->
        <div class="card">
          <span class="card-kicker">Interviewed</span>
          <span class="card-title">{{ data.interviewed }}</span>
          <span class="kpi__note text-muted">{{ pct(data.interviewed, data.total) }}% of all</span>
        </div>
        <div class="card">
          <span class="card-kicker">Stalled {{ data.stalledAfterDays }}d+</span>
          <span class="card-title">{{ data.stalled.length }}</span>
          <span class="kpi__note text-muted">of {{ data.live }} live</span>
        </div>
      </div>

      <!-- Emphasis, not 12 hues: live in the accent, ended in gray. Identity
           comes from the row label, so colour only has to carry live/ended. -->
      <section class="section">
        <h2 class="section__title">Pipeline</h2>
        <table class="chart">
          <caption class="visually-hidden">Applications by status</caption>
          <tbody>
            <tr v-for="s in data.byStatus" :key="s.label">
              <th scope="row" class="chart__label">{{ s.label }}</th>
              <td class="chart__track">
                <span
                  class="chart__bar"
                  :class="s.isTerminal ? 'chart__bar--ended' : 'chart__bar--live'"
                  :style="`--w:${(s.count / maxStatus) * 100}%`"
                />
                <span class="chart__value">{{ s.count }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="chart__legend text-muted">
          <span class="swatch swatch--live" /> still live
          <span class="swatch swatch--ended" /> ended
        </p>
      </section>

      <section class="section">
        <h2 class="section__title">Applications per month</h2>
        <table class="chart">
          <caption class="visually-hidden">Applications submitted per month</caption>
          <tbody>
            <tr v-for="m in data.perMonth" :key="m.month">
              <th scope="row" class="chart__label chart__label--sm">{{ monthLabel(m.month) }}</th>
              <td class="chart__track">
                <span class="chart__bar chart__bar--live" :style="`--w:${(m.count / maxMonth) * 100}%`" />
                <span class="chart__value">{{ m.count }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Deliberately not a chart: four data points is a number, not a
           distribution (docs/PRD.md). -->
      <section class="section">
        <h2 class="section__title">Response times</h2>
        <div class="kpis">
          <div class="card">
            <span class="card-kicker">First reply</span>
            <span class="card-title">
              {{ data.durations.response.median !== null ? `${data.durations.response.median}d` : '—' }}
            </span>
            <span class="kpi__note text-muted">median of {{ data.durations.response.n }}</span>
          </div>
          <div class="card">
            <span class="card-kicker">To rejection</span>
            <span class="card-title">
              {{ data.durations.rejection.median !== null ? `${data.durations.rejection.median}d` : '—' }}
            </span>
            <span class="kpi__note text-muted">median of {{ data.durations.rejection.n }}</span>
          </div>
          <div class="card">
            <span class="card-kicker">To offer</span>
            <span class="card-title">
              {{ data.durations.offer.median !== null ? `${data.durations.offer.median}d` : '—' }}
            </span>
            <span class="kpi__note text-muted">median of {{ data.durations.offer.n }}</span>
          </div>
        </div>
        <p class="caveat">
          Computed from status history, which only
          <strong>{{ data.durations.withHistory }} of {{ data.total }}</strong>
          applications have — the spreadsheet import carried no transition dates.
          Treat these as indicative until the sample grows; add dates on an
          application's History section to widen it.
        </p>
      </section>

      <section class="section">
        <div class="page-head">
          <h2 class="section__title">Stalled</h2>
          <div class="cluster">
            <label class="text-muted" for="stalledAfter">No movement in</label>
            <select
              id="stalledAfter"
              class="input stalled__select"
              :value="stalledAfter"
              @change="router.push({ query: { stalledAfter: ($event.target as HTMLSelectElement).value } })"
            >
              <option v-for="d in [14, 30, 60, 90]" :key="d" :value="d">{{ d }} days</option>
            </select>
          </div>
        </div>

        <p v-if="!data.stalled.length" class="empty text-muted">
          Nothing has been sitting untouched that long.
        </p>
        <div v-else class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
                <th>Quiet for</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="a in data.stalled.slice(0, 25)"
                :key="a.id"
                class="row--clickable"
                @click="navigateTo(`/applications/${a.id}`)"
              >
                <td class="cell--wrap">{{ a.company }}</td>
                <td class="cell--wrap">{{ a.role ?? '—' }}</td>
                <td>{{ a.statusLabel }}</td>
                <td class="cell--tight">{{ a.days }} days</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="data.stalled.length > 25" class="meta-note text-muted">
          Showing the 25 quietest of {{ data.stalled.length }}.
        </p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}

.kpi__note {
  font-size: var(--text-sm);
}

.chart {
  width: 100%;
  border-collapse: collapse;
}

.chart__label {
  text-align: left;
  font-weight: 400;
  font-size: var(--text-md);
  /* Long status names, so give them a fixed gutter and let bars share a baseline. */
  width: 190px;
  padding: 0 var(--space-3) 0 0;
  white-space: nowrap;
}

.chart__label--sm {
  width: 90px;
}

.chart__track {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 2px vertical gap between bars, per the mark spec. */
  padding: 1px 0;
}

.chart__bar {
  display: block;
  width: var(--w);
  height: 18px;
  /* Zero radius: the design system is explicit about it, so no rounded ends. */
  border-radius: 0;
  /* A zero-count status still shows a tick, so the row does not look broken. */
  min-width: 2px;
}

.chart__bar--live {
  background: var(--color-accent);
}

.chart__bar--ended {
  background: var(--color-neutral-600);
}

.chart__value {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}

.chart__legend {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
}

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
}

.swatch--live {
  background: var(--color-accent);
}

.swatch--ended {
  background: var(--color-neutral-600);
}

.swatch--ended {
  margin-left: var(--space-3);
}

.caveat {
  margin: var(--space-3) 0 0;
  padding: var(--space-3);
  background: var(--color-surface);
  border-left: var(--rule-accent);
  font-size: var(--text-md);
}

.stalled__select {
  width: auto;
}
</style>
