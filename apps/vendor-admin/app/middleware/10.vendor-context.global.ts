// Loads the signed-in account's vendor capabilities and feature flags before any page renders, so a
// page's own data loading (billing sections, shared onboarding) can rely on `can()` at setup time.
// Runs after 00.auth.global, which has already loaded the session; signed-out pages skip the request.
export default defineNuxtRouteMiddleware(async () => {
  const { ready, refresh } = useVendorContext()
  await ready
  await refresh()
})
