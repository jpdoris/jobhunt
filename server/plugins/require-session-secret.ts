/**
 * The app refuses to start without a session secret rather than falling back to
 * a baked-in default (docs/PRD.md).
 */
export default defineNitroPlugin(() => {
  const secret = process.env.NUXT_SESSION_PASSWORD
  if (!secret || secret.length < 32) {
    throw new Error(
      'NUXT_SESSION_PASSWORD is missing or shorter than 32 characters.\n' +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
        'then put it in .env as NUXT_SESSION_PASSWORD=…',
    )
  }
})
