import { MOBILE_STEP_PATH, mobileStepRedirect } from '@/composables/useMe'

// Runs after auth.global.ts, which has already resolved `me`: a signed-in user without a mobile number sees only the
// mobile step (and sign-out) until it is saved. Public pages (pay, book, join, reset) are left before `useMe()` runs,
// because reading it there would request /api/v1/me for an anonymous visitor.
export default defineNuxtRouteMiddleware((to) => {
  if (to.meta?.access === 'public' || to.path === MOBILE_STEP_PATH) return
  const redirect = mobileStepRedirect(useMe().me.value, to)
  if (redirect) return navigateTo(redirect, { replace: true })
})
