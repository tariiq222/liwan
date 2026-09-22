export default defineNuxtRouteMiddleware(async (to) => {
  const { enabled, capabilities, ready, refresh } = useVendorContext()
  if (!enabled) return abortNavigation(createError({ statusCode: 404, statusMessage: 'Not Found' }))
  await ready
  await refresh()
  const required = to.meta.vendorCapability
  if (typeof required !== 'string') return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }))
  if (!capabilities.value.includes(required as never)) return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }))
})
