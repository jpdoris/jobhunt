import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Tests run as plain Node, not under Nuxt, so Nuxt's `#shared` alias has to be
 * declared here or any server/util that imports a shared type is unimportable.
 */
export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
})
