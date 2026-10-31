<script setup lang="ts">
/**
 * Search box with a leading glyph and a trailing clear button. The clear
 * button only shows once there is something to clear; Escape does the same
 * from the keyboard. Callers own the debounce and the URL sync — this only
 * edits the value.
 */
defineProps<{ id: string; placeholder?: string }>()
const model = defineModel<string>({ required: true })
const input = ref<HTMLInputElement>()

function clear() {
  model.value = ''
  input.value?.focus()
}
</script>

<template>
  <div class="search-input">
    <span class="search-input__glyph"><AppIcon name="search" /></span>
    <input
      :id="id"
      ref="input"
      v-model="model"
      class="input"
      :placeholder="placeholder"
      @keydown.esc="model && clear()"
    />
    <button
      v-if="model"
      type="button"
      class="search-input__clear"
      aria-label="Clear search"
      @click="clear"
    >
      <AppIcon name="close" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.search-input {
  position: relative;
}

.search-input__glyph {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.55;
  pointer-events: none;
}

.search-input .input {
  padding-inline: 30px;
}

.search-input__clear {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: var(--control-h);
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--ink-muted);
  background: none;
  border: none;
  cursor: pointer;
}

.search-input__clear:hover {
  color: var(--color-text);
}

.search-input__clear:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
</style>
