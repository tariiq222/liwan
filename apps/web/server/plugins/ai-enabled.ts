// `public.aiEnabled` follows the RUNTIME `aiServiceUrl` and `aiServiceToken`, so one image works with or without the AI
// service. The shared runtime config is frozen once the server starts; the per-request copy is what the SSR payload is
// built from, so it is set there. Outside development a configured URL with an empty token hides /ai: the service
// refuses every caller without its token.
let warnedMissingToken = false

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const config = useRuntimeConfig(event)
    const tokenMissing = Boolean(config.aiServiceUrl) && !config.aiServiceToken && !import.meta.dev
    if (tokenMissing && !warnedMissingToken) {
      warnedMissingToken = true
      console.error('[liwan-ai] NUXT_AI_SERVICE_TOKEN is empty: /ai stays hidden')
    }
    config.public.aiEnabled = Boolean(config.aiServiceUrl && (config.aiServiceToken || import.meta.dev))
  })
})
