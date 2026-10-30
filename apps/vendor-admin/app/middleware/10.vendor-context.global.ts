// Loads the signed-in account's vendor capabilities and feature flags before a page renders, so a
// page's own data loading (billing sections, shared onboarding) can rely on `can()` at setup time.
// Runs after 00.auth.global. It loads once per account, not on every navigation, and registers no
// watcher or route hook: a 401 sends the sign-in page the target route as `next`.
export default defineNuxtRouteMiddleware(async (to) => {
  const state = useVendorContextState()
  const fetcher = useRequestFetch()
  await state.ensure(() => fetcher('/api/vendor/v1/context'))
  if (state.error.value?.statusCode === 401) return navigateTo({ path: '/login', query: { next: to.fullPath } })
  // An account that holds no role is refused by the control plane: say so instead of showing a generic outage.
  if (state.error.value?.statusCode === 403) throw createError({ statusCode: 403, statusMessage: 'forbidden', fatal: true })
})
