import { mobileStepRedirect } from '@/composables/useMe'

// Runs after auth.global.ts, which has already resolved `me`: a signed-in user without a mobile number sees only the
// mobile step (and sign-out) until it is saved.
export default defineNuxtRouteMiddleware((to) => {
  const redirect = mobileStepRedirect(useMe().me.value, to)
  if (redirect) return navigateTo(redirect, { replace: true })
})
