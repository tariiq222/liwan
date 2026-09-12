import { legacyProjectTabTarget } from '@/utils/legacyProjectTab'

// A 302, not a 301: a permanent redirect is cached by the browser and cannot
// be withdrawn if the section path ever changes again.
export default defineNuxtRouteMiddleware(to => {
  const target = legacyProjectTabTarget(to.path, to.query as Record<string, unknown>)
  if (target) return navigateTo(target, { replace: true, redirectCode: 302 })
})
