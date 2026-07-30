<script setup lang="ts">
definePageMeta({ layout: false })

const email = ref('')
const password = ref('')
const error = ref('')
const pending = ref(false)

const { fetch: refreshSession } = useUserSession()

async function signIn() {
  error.value = ''
  pending.value = true
  try {
    await $fetch('/api/login', { method: 'POST', body: { email: email.value, password: password.value } })
    await refreshSession()
    await navigateTo('/')
  } catch {
    error.value = 'Invalid email or password.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="center-screen">
    <form class="auth" @submit.prevent="signIn">
      <div class="auth__head">
        <div class="card-title">Job Hunt</div>
        <p class="text-muted">Sign in to your applications</p>
      </div>

      <div class="auth__card">
        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <p v-if="error" class="error-text">{{ error }}</p>
        <button class="btn btn-primary btn-block" type="submit" :disabled="pending">
          {{ pending ? 'Signing in…' : 'Sign in' }}
        </button>
      </div>

      <p class="auth__foot text-muted">Accounts are created by the owner. No self-signup.</p>
    </form>
  </div>
</template>

<style scoped>
.center-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth {
  width: var(--measure-auth);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.auth__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-6);
  background: var(--color-bg);
  border: var(--rule);
}

.auth__head,
.auth__foot {
  text-align: center;
}

.auth__foot {
  font-size: var(--text-sm);
  margin: 0;
}
</style>
