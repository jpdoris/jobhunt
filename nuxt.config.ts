// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['nuxt-auth-utils'],

  // Order matters: tokens define the custom properties the other two read.
  css: ['~/assets/css/tokens.css', '~/assets/css/base.css', '~/assets/css/components.css'],

  app: {
    head: {
      title: 'Job Hunt',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },

  devServer: {
    // Loopback only — see docs/PRD.md. Auth exists, but nothing here is meant
    // to be reachable from the network yet.
    host: '127.0.0.1',
    port: 3000,
  },

  nitro: {
    // better-sqlite3 is a native module; bundling it breaks the binding.
    externals: { external: ['better-sqlite3'] },
  },

  typescript: {
    strict: true,
  },
})
