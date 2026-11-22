// Loads the signed-in account's vendor capabilities and feature flags before a page renders, so a
// page's own data loading (billing sections, shared onboarding) can rely on `can()` at setup time.
// Runs after 00.auth.global. It loads once per account, not on every navigation, and registers no
// watcher or route hook: a 401 ends the local session and sends the sign-in page the target route as `next`.
// Public pages (sign-in, enrollment) never need the context, and the sign-in page must render while the BFF is down.
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.meta.public === true) return
  const state = useVendorContextState()
  const fetcher = useRequestFetch()
  await state.ensure(() => fetcher('/api/vendor/v1/context'))
  if (state.error.value?.statusCode === 401) {
    // The proxy already dropped the cookie: without this the sign-in page still sees a profile and bounces back here.
    state.me.value = null
    state.actorChanged(null)
    return navigateTo({ path: '/login', query: { next: to.fullPath } })
  }
  // An account that holds no role is refused by the control plane: say so instead of showing a generic outage.
  if (state.error.value?.statusCode === 403) throw createError({ statusCode: 403, statusMessage: 'forbidden', fatal: true })
})
