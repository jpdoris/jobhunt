<script setup lang="ts">
import { formatBytes, MAX_UPLOAD_BYTES } from '#shared/types'
import type { DocumentRecord } from '#shared/types'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()
const { ask } = useConfirm()

const query = computed(() => ({
  search: (route.query.search as string) || undefined,
  kindId: route.query.kindId ? Number(route.query.kindId) : undefined,
}))

const { data, refresh } = await useFetch('/api/documents', { query })

/**
 * Where the user came from, if the application detail page sent them here.
 * The fetch is tolerant on purpose: a stale, deleted or someone else's id
 * should quietly drop the back link, not error the whole page.
 */
const fromId = computed(() => {
  const value = Number(route.query.from)
  return Number.isInteger(value) && value > 0 ? value : null
})

// During SSR a bare $fetch does not carry the session cookie, so the request
// would 401 and the back link would silently never render. useFetch forwards
// them; a plain $fetch has to be handed them explicitly. Empty on the client,
// where the browser attaches cookies itself.
const requestHeaders = useRequestHeaders(['cookie'])

const { data: origin } = await useAsyncData(
  'documents-origin',
  async () => {
    if (!fromId.value) return null
    try {
      return await $fetch<{ id: number; company: string }>(
        `/api/applications/${fromId.value}`,
        { headers: requestHeaders },
      )
    } catch {
      return null
    }
  },
  { watch: [fromId] },
)
const documents = computed<DocumentRecord[]>(() => data.value?.documents ?? [])
const kinds = computed(() => data.value?.kinds ?? [])

function setQuery(patch: Record<string, string | undefined>) {
  const q = { ...route.query, ...patch }
  for (const [k, v] of Object.entries(q)) if (!v) delete q[k]
  router.push({ query: q })
}

/** `from` is provenance, not a filter — clearing filters must not strip it. */
const activeFilters = computed(() =>
  Object.keys(route.query).filter((k) => k !== 'from'),
)

function clearFilters() {
  router.push({ query: fromId.value ? { from: String(fromId.value) } : {} })
}

const search = ref((route.query.search as string) ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => setQuery({ search: v || undefined }), 250)
})
onBeforeUnmount(() => clearTimeout(timer))

/* Upload ------------------------------------------------------------------ */

const showUpload = ref(false)
const uploadBackdrop = useBackdropDismiss(() => (showUpload.value = false))
const uploading = ref(false)
const error = ref('')
const notice = ref('')

const form = reactive({ kindId: 1, title: '', contentText: '' })
const fileInput = ref<HTMLInputElement | null>(null)

function openUpload() {
  form.kindId = kinds.value[0]?.id ?? 1
  form.title = ''
  form.contentText = ''
  error.value = ''
  showUpload.value = true
}

async function upload() {
  error.value = ''
  const file = fileInput.value?.files?.[0]
  if (!file && !form.contentText.trim()) {
    error.value = 'Choose a file, or paste some text.'
    return
  }
  if (file && file.size > MAX_UPLOAD_BYTES) {
    error.value = `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`
    return
  }

  const body = new FormData()
  body.append('kindId', String(form.kindId))
  if (form.title.trim()) body.append('title', form.title.trim())
  if (form.contentText.trim()) body.append('contentText', form.contentText.trim())
  if (file) body.append('file', file)

  uploading.value = true
  try {
    const res = await $fetch<{ extraction: { extracted: boolean; note?: string } }>(
      '/api/documents',
      { method: 'POST', body },
    )
    // A file can store fine and still be unsearchable; say so rather than
    // letting the user wonder why search misses it.
    notice.value = res.extraction.extracted ? '' : (res.extraction.note ?? '')
    showUpload.value = false
    await refresh()
  } catch (e) {
    error.value = (e as { data?: { message?: string } }).data?.message ?? 'Upload failed.'
  } finally {
    uploading.value = false
  }
}

/* Edit / delete ----------------------------------------------------------- */

const editing = ref<DocumentRecord | null>(null)
const editBackdrop = useBackdropDismiss(() => (editing.value = null))
const editForm = reactive({ title: '', kindId: 1, contentText: '' })

async function openEdit(doc: DocumentRecord) {
  const full = await $fetch<DocumentRecord>(`/api/documents/${doc.id}`)
  editForm.title = full.title
  editForm.kindId = full.kindId
  editForm.contentText = full.contentText ?? ''
  editing.value = full
}

async function saveEdit() {
  if (!editing.value) return
  await $fetch(`/api/documents/${editing.value.id}`, { method: 'PUT', body: { ...editForm } })
  editing.value = null
  await refresh()
}

async function remove(doc: DocumentRecord) {
  const used = doc.attachedCount
    ? `It is attached to ${doc.attachedCount} application${doc.attachedCount > 1 ? 's' : ''}. `
    : ''
  const ok = await ask({
    title: `Delete "${doc.title}"?`,
    message: `${used}The file is removed from disk. This cannot be undone.`,
  })
  if (!ok) return
  await $fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div>
    <AppNav />

    <main class="page page--narrow">
      <NuxtLink v-if="origin" class="btn btn-ghost" :to="`/applications/${origin.id}`">
        <AppIcon name="back" /> Back to {{ origin.company }}
      </NuxtLink>

      <div class="page-head">
        <div>
          <h1 class="page-head__title">Documents</h1>
          <p class="page-head__sub text-muted">
            {{ documents.length }} résumé{{ documents.length === 1 ? '' : 's' }} and cover letters
          </p>
        </div>
        <button class="btn btn-primary" @click="openUpload">
          <AppIcon name="plus" /> Add document
        </button>
      </div>

      <p v-if="notice" class="notice">{{ notice }}</p>

      <div class="filter-bar">
        <div class="field field--grow">
          <label for="doc-search">Search</label>
          <div class="input-icon">
            <span class="input-icon__glyph"><AppIcon name="search" /></span>
            <input id="doc-search" v-model="search" class="input" placeholder="Title or contents…" />
          </div>
        </div>
        <div class="field field--md">
          <label for="doc-kind">Kind</label>
          <select
            id="doc-kind"
            class="input"
            :value="route.query.kindId ?? ''"
            @change="setQuery({ kindId: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">All</option>
            <option v-for="k in kinds" :key="k.id" :value="k.id">{{ k.label }}</option>
          </select>
        </div>
        <button v-if="activeFilters.length" class="btn btn-ghost" @click="clearFilters">
          Clear
        </button>
      </div>

      <p v-if="!documents.length" class="empty text-muted">
        No documents yet. Add a résumé or cover letter to attach it to applications.
      </p>

      <div v-else class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Kind</th>
              <th>Size</th>
              <th>Searchable</th>
              <th>Used by</th>
              <th><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in documents" :key="doc.id">
              <td class="cell--wrap">
                <a v-if="doc.filePath" :href="`/api/documents/${doc.id}/file`" target="_blank" rel="noopener">
                  {{ doc.title }}
                </a>
                <span v-else>{{ doc.title }}</span>
              </td>
              <td>{{ doc.kindLabel }}</td>
              <td class="cell--tight">{{ formatBytes(doc.byteSize) }}</td>
              <td>
                <span v-if="doc.hasText" class="tag tag-generic">Yes</span>
                <span v-else class="tag tag-outline" title="No text was extracted — edit to paste it">No</span>
              </td>
              <td class="cell--tight">
                {{ doc.attachedCount }} application{{ doc.attachedCount === 1 ? '' : 's' }}
              </td>
              <td>
                <div class="cluster">
                  <button class="btn btn-ghost" @click="openEdit(doc)">Edit</button>
                  <button class="btn btn-ghost" @click="remove(doc)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <!-- Upload -->
    <div v-if="showUpload" class="dialog-backdrop" v-on="uploadBackdrop">
      <form class="dialog" @submit.prevent="upload">
        <div class="dialog-title">Add document</div>

        <div class="field">
          <label for="up-kind">Kind</label>
          <select id="up-kind" v-model.number="form.kindId" class="input">
            <option v-for="k in kinds" :key="k.id" :value="k.id">{{ k.label }}</option>
          </select>
        </div>

        <div class="field">
          <label for="up-file">File</label>
          <input
            id="up-file"
            ref="fileInput"
            class="input"
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          />
          <p class="field__hint text-muted">
            PDF, DOCX, TXT or MD, up to {{ formatBytes(MAX_UPLOAD_BYTES) }}. Text is extracted
            automatically so the document is searchable.
          </p>
        </div>

        <div class="field">
          <label for="up-title">Title</label>
          <input id="up-title" v-model="form.title" class="input" placeholder="Defaults to the filename" />
        </div>

        <div class="field">
          <label for="up-text">Text (optional)</label>
          <textarea
            id="up-text"
            v-model="form.contentText"
            class="input"
            placeholder="Paste the text if the file is a scan, or to store text with no file at all"
          />
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>

        <div class="dialog-actions">
          <button class="btn btn-secondary" type="button" @click="showUpload = false">Cancel</button>
          <button class="btn btn-primary" type="submit" :disabled="uploading">
            {{ uploading ? 'Uploading…' : 'Add document' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Edit -->
    <div v-if="editing" class="dialog-backdrop" v-on="editBackdrop">
      <form class="dialog" @submit.prevent="saveEdit">
        <div class="dialog-title">Edit document</div>

        <div class="field">
          <label for="ed-title">Title</label>
          <input id="ed-title" v-model="editForm.title" class="input" required />
        </div>
        <div class="field">
          <label for="ed-kind">Kind</label>
          <select id="ed-kind" v-model.number="editForm.kindId" class="input">
            <option v-for="k in kinds" :key="k.id" :value="k.id">{{ k.label }}</option>
          </select>
        </div>
        <div class="field">
          <label for="ed-text">Text</label>
          <textarea id="ed-text" v-model="editForm.contentText" class="input textarea--tall" />
          <p class="field__hint text-muted">This is what search reads. The stored file is unchanged.</p>
        </div>

        <div class="dialog-actions">
          <button class="btn btn-secondary" type="button" @click="editing = null">Cancel</button>
          <button class="btn btn-primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.notice {
  margin: 0 0 var(--space-4);
  padding: var(--space-2) var(--space-3);
  background: var(--color-accent-100);
  color: var(--color-accent-800);
  font-size: var(--text-md);
}

.field__hint {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
}

.textarea--tall {
  min-height: 220px;
}
</style>
