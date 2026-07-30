<script setup lang="ts">
import { statusTagClass } from '#shared/types'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { data: application, refresh } = await useFetch(`/api/applications/${route.params.id}`)
const { data: lookups } = await useFetch('/api/lookups')

const editing = ref(false)

async function onSaved() {
  editing.value = false
  await refresh()
}

async function remove() {
  if (!confirm(`Delete the ${application.value?.company} application? This cannot be undone.`)) return
  await $fetch(`/api/applications/${route.params.id}`, { method: 'DELETE' })
  await navigateTo('/')
}
</script>

<template>
  <div v-if="application">
    <AppNav />

    <main class="page page--narrow">
      <button class="btn btn-ghost" @click="navigateTo('/')">
        <AppIcon name="back" /> Back to applications
      </button>

      <div class="page-head page-head--top">
        <div>
          <h1>{{ application.company }}</h1>
          <p class="page-head__sub text-muted">{{ application.role ?? '—' }}</p>
        </div>
        <div class="cluster">
          <button class="btn btn-secondary" @click="editing = true">
            <AppIcon name="edit" /> Edit
          </button>
          <button class="btn btn-secondary" @click="remove">
            <AppIcon name="trash" /> Delete
          </button>
        </div>
      </div>

      <div class="detail-tag">
        <span class="tag tag--lg" :class="statusTagClass(application)">
          {{ application.statusLabel }}
        </span>
      </div>

      <div class="detail-meta">
        <div>
          <div class="detail-meta__label">Next step</div>
          <div>{{ application.nextStepLabel }}</div>
        </div>
        <div>
          <div class="detail-meta__label">When</div>
          <div>{{ formatInstant(application.nextStepDateTime) }}</div>
        </div>
        <div>
          <div class="detail-meta__label">Applied</div>
          <div>{{ formatApplyDate(application.applyDate) }}</div>
        </div>
        <div>
          <div class="detail-meta__label">Filed with unemployment</div>
          <div>{{ application.submittedToUnemployment ? 'Yes' : 'No' }}</div>
        </div>
        <div>
          <div class="detail-meta__label">Recruiter</div>
          <div>{{ application.contact ?? '—' }}</div>
        </div>
        <div>
          <div class="detail-meta__label">Posting</div>
          <div>
            <a v-if="application.jobPostingLink" :href="application.jobPostingLink" target="_blank" rel="noopener">
              View original posting
            </a>
            <span v-else>—</span>
          </div>
        </div>
      </div>

      <div class="section">
        <h2 class="section__title">Description</h2>
        <p class="section__body text-muted">{{ application.description || 'No description recorded.' }}</p>
      </div>

      <div class="section">
        <h2 class="section__title">Notes</h2>
        <p class="section__body text-muted">{{ application.notes || 'No notes.' }}</p>
      </div>
    </main>

    <ApplicationForm
      v-if="editing"
      :application="application"
      :statuses="lookups?.statuses ?? []"
      :next-steps="lookups?.nextSteps ?? []"
      @close="editing = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.page-head--top {
  align-items: flex-start;
  margin-bottom: var(--space-2);
}

.detail-tag {
  margin: var(--space-4) 0 var(--space-6);
}

.tag--lg {
  font-size: var(--text-base);
  padding: 5px 12px;
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-5);
  padding: var(--space-5) 0;
  border-top: var(--rule);
  border-bottom: var(--rule);
  margin-bottom: var(--space-6);
}

.detail-meta__label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  margin-bottom: var(--space-1);
  color: var(--ink-muted);
}

.section {
  margin-bottom: var(--space-6);
}

.section__title {
  font-size: var(--text-lg);
  margin-bottom: var(--space-2);
}

/* Descriptions are pasted job postings — preserve their line breaks. */
.section__body {
  margin: 0;
  white-space: pre-wrap;
}

@media (max-width: 720px) {
  .detail-meta {
    grid-template-columns: 1fr;
  }
}
</style>
