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
      // SVG first — browsers that support it get a mark that stays sharp at any
      // size; the rest fall back to the multi-resolution .ico.
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
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
