<script setup lang="ts">
/**
 * Mounted once in app.vue; driven by useConfirm().
 *
 * Uses the native <dialog> element with showModal(), which supplies the things
 * a hand-rolled overlay has to reimplement badly: focus is trapped inside,
 * Escape closes it, the rest of the page is inert to assistive tech, and focus
 * returns to whatever opened it.
 */
const { state, settle } = useConfirm()
const el = ref<HTMLDialogElement | null>(null)

watch(
  () => state.value.open,
  (open) => {
    const dialog = el.value
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  },
)

/** Escape and the close button both land here, so both count as cancelling. */
function onCancel(event: Event) {
  event.preventDefault()
  settle(false)
}

/** showModal() sizes the dialog to its content, so a click outside it is on the element itself. */
const backdrop = useBackdropDismiss(() => settle(false))
</script>

<template>
  <dialog
    ref="el"
    class="dialog confirm"
    aria-labelledby="confirm-title"
    @cancel="onCancel"
    v-on="backdrop"
  >
    <div v-if="state.request" class="confirm__body">
      <h2 id="confirm-title" class="dialog-title">{{ state.request.title }}</h2>
      <p v-if="state.request.message" class="confirm__message text-muted">
        {{ state.request.message }}
      </p>

      <div class="dialog-actions">
        <!-- Focused on open, so Enter cancels rather than destroying something. -->
        <button autofocus class="btn btn-secondary" type="button" @click="settle(false)">
          {{ state.request.cancelLabel ?? 'Cancel' }}
        </button>
        <button class="btn btn-primary" type="button" @click="settle(true)">
          {{ state.request.confirmLabel ?? 'Delete' }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
/* .dialog sets display:flex, and an author rule outranks the UA stylesheet's
   `dialog:not([open]) { display: none }` — without this the dialog would be
   permanently visible on every page. */
.confirm:not([open]) {
  display: none;
}

/* The UA gives <dialog> its own border, padding and auto margins; .dialog
   supplies the look, so only the centring and reset belong here. */
.confirm {
  margin: auto;
  padding: var(--space-6);
  color: var(--color-text);
}

.confirm__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.confirm__message {
  margin: 0;
}

.confirm::backdrop {
  background: var(--color-scrim);
}
</style>
