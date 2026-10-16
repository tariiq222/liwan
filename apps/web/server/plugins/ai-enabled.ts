// `public.aiEnabled` follows the RUNTIME `aiServiceUrl`, so one image works with or without the AI service. The shared runtime
// config is frozen once the server starts; the per-request copy is what the SSR payload is built from, so it is set there.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const config = useRuntimeConfig(event)
    config.public.aiEnabled = Boolean(config.aiServiceUrl)
  })
})
