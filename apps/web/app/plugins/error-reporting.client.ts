// Reports Vue errors when the server says reporting is on (`public.errorReporting`, filled at runtime by
// server/plugins/error-reporting.ts). Off: the SDK is never downloaded and nothing is sent.
export default defineNuxtPlugin((nuxtApp) => {
  const settings = useRuntimeConfig().public.errorReporting
  if (!settings.enabled) return
  const userId = () => {
    const me = nuxtApp.payload.data.me as { id?: number } | null | undefined
    return me?.id
  }
  const reporter = import('../utils/errorReporting').then(({ startBrowserReporting }) => startBrowserReporting(settings, userId))
  nuxtApp.hook('vue:error', async (error) => { (await reporter).capture(error) })
})
