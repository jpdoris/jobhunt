<script setup lang="ts">
import { statusTagClass } from '#shared/types'
import { googleCalendarUrl } from '#shared/calendar'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { data: application, refresh } = await useFetch(`/api/applications/${route.params.id}`)
const { data: lookups } = await useFetch('/api/lookups')
const { data: attached, refresh: refreshAttached } = await useFetch(
  `/api/applications/${route.params.id}/documents`,
)
const { data: library } = await useFetch('/api/documents')

const attachId = ref<number | null>(null)
const { ask } = useConfirm()

/** Only offer documents that are not already on this application. */
const attachable = computed(() => {
  const on = new Set((attached.value ?? []).map((d) => d.id))
  return (library.value?.documents ?? []).filter((d) => !on.has(d.id))
})

async function attach() {
  if (!attachId.value) return
  await $fetch(`/api/applications/${route.params.id}/documents`, {
    method: 'POST',
    body: { documentId: attachId.value },
  })
  attachId.value = null
  await refreshAttached()
}

async function detach(documentId: number) {
  // Detaching only removes the link — the document stays in the library.
  await $fetch(`/api/applications/${route.params.id}/documents/${documentId}`, { method: 'DELETE' })
  await refreshAttached()
}

const editing = ref(false)

async function onSaved() {
  editing.value = false
  await refresh()
}

async function remove() {
  const ok = await ask({
    title: `Delete the ${application.value?.company} application?`,
    message: 'Its history is deleted too. Attached documents stay in your library. This cannot be undone.',
  })
  if (!ok) return
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
          <!-- One-way handoff: opens the composer / downloads a file. Nothing
               is synced back (docs/PRD.md). -->
          <div v-if="application.nextStepDateTime" class="cal-actions">
            <a
              class="btn btn-ghost"
              :href="googleCalendarUrl(application)!"
              target="_blank"
              rel="noopener"
            >
              <AppIcon name="calendar" /> Google Calendar
            </a>
            <a class="btn btn-ghost" :href="`/api/applications/${application.id}/calendar.ics`">
              <AppIcon name="download" /> .ics
            </a>
          </div>
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
        <h2 class="section__title">History</h2>
        <StatusTimeline
          :application-id="application.id"
          :statuses="lookups?.statuses ?? []"
          @changed="refresh()"
        />
      </div>

      <div class="section">
        <h2 class="section__title">Documents</h2>

        <ul v-if="attached?.length" class="doc-list">
          <li v-for="doc in attached" :key="doc.id" class="doc-list__item">
            <a v-if="doc.filePath" :href="`/api/documents/${doc.id}/file`" target="_blank" rel="noopener">
              {{ doc.title }}
            </a>
            <span v-else>{{ doc.title }}</span>
            <span class="tag tag-generic">{{ doc.kindLabel }}</span>
            <button class="btn btn-ghost" @click="detach(doc.id)">Remove</button>
          </li>
        </ul>
        <p v-else class="section__body text-muted">Nothing attached yet.</p>

        <div class="cluster doc-attach">
          <template v-if="attachable.length">
            <select v-model.number="attachId" class="input doc-attach__select" aria-label="Document to attach">
              <option :value="null">Attach a document…</option>
              <option v-for="doc in attachable" :key="doc.id" :value="doc.id">
                {{ doc.kindLabel }} — {{ doc.title }}
              </option>
            </select>
            <button class="btn btn-secondary" :disabled="!attachId" @click="attach">Attach</button>
          </template>

          <!-- ?from= lets the library offer a way back here. A query param
               rather than the referrer: referrer is absent during SSR, lost on
               reload, and stripped by some privacy settings. -->
          <NuxtLink class="btn btn-ghost" :to="`/documents?from=${application.id}`">
            <AppIcon name="plus" /> Add or manage documents
          </NuxtLink>
        </div>

        <p v-if="!library?.documents?.length" class="section__body text-muted">
          Your library is empty — add a résumé or cover letter to attach it here.
        </p>
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

/* .section / .section__title are global — four pages use them now. */

/* Descriptions are pasted job postings — preserve their line breaks. */
.section__body {
  margin: 0;
  white-space: pre-wrap;
}

.cal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
  margin-left: calc(var(--space-1) * -1);
}

.doc-list {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.doc-list__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.doc-attach__select {
  width: auto;
  min-width: 260px;
}

@media (max-width: 720px) {
  .detail-meta {
    grid-template-columns: 1fr;
  }
}
</style>
