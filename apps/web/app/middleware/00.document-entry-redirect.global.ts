import { documentEntryRedirect } from '../modules/documents/entryRedirect'
export default defineNuxtRouteMiddleware(to => {
  const target = documentEntryRedirect(to)
  if (target) return navigateTo(target, { replace: true, redirectCode: 301 })
})
