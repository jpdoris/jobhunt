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

  runtimeConfig: {
    session: {
      cookie: {
        /**
         * h3 defaults the session cookie to Secure, which browsers refuse to
         * store or send over plain http. Served at http://jobhunt.test that
         * makes login fail *silently*: the POST succeeds, the browser drops the
         * cookie, the auth middleware finds no session and redirects back to
         * the login page with nothing to show.
         *
         * curl does not enforce Secure, so this is invisible to command-line
         * testing — it only appears in a real browser.
         *
         * Set NUXT_SESSION_COOKIE_SECURE=true if this is ever served over https.
         */
        secure: false,
      },
    },
  },
})
