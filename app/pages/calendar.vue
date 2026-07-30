<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { data } = await useFetch('/api/applications')
const upcoming = computed(() =>
  (data.value?.applications ?? [])
    .filter((a) => a.nextStepDateTime)
    .sort((a, b) => (a.nextStepDateTime! < b.nextStepDateTime! ? -1 : 1)),
)
</script>

<template>
  <div>
    <AppNav />
    <main class="page page--narrow">
      <div class="page-head">
        <div>
          <h1 class="page-head__title">Calendar</h1>
          <p class="page-head__sub text-muted">Upcoming next steps</p>
        </div>
      </div>

      <p v-if="!upcoming.length" class="empty text-muted">
        Nothing scheduled. Next steps appear here once an application has a date and time.
      </p>

      <div v-else class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Company</th>
              <th>Next step</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in upcoming"
              :key="a.id"
              class="row--clickable"
              @click="navigateTo(`/applications/${a.id}`)"
            >
              <td class="cell--tight">{{ formatInstant(a.nextStepDateTime) }}</td>
              <td>{{ a.company }}</td>
              <td>{{ a.nextStepLabel }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>
</template>
