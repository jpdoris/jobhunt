<script setup lang="ts">
defineProps<{ showActions?: boolean }>()
const emit = defineEmits<{ export: [] }>()

const { clear } = useUserSession()

async function signOut() {
  await $fetch('/api/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <nav class="nav">
    <div class="nav-brand">Job Hunt</div>
    <NuxtLink to="/">Applications</NuxtLink>
    <NuxtLink to="/calendar">Calendar</NuxtLink>
    <div class="cluster cluster--end">
      <button v-if="showActions" class="btn btn-secondary" @click="emit('export')">
        <AppIcon name="download" /> Export CSV
      </button>
      <button class="btn btn-ghost" @click="signOut">Sign out</button>
    </div>
  </nav>
</template>

<style scoped>
/* Pushes the sign-out / export group to the far end of the nav bar. */
.cluster--end {
  margin-left: auto;
  gap: var(--space-3);
}
</style>
