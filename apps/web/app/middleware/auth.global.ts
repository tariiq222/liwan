import { canReachPath } from '@/utils/accessPolicy'
export default defineNuxtRouteMiddleware(async (to) => {
  const nuxtApp = useNuxtApp()
  const { $i18n } = nuxtApp
  const { me, error, ready, refresh } = useMe()
  // List debounce writers must pause before the awaited identity refresh can
  // leave an outgoing navigation pending. This notification never grants access.
  if (import.meta.client) await nuxtApp.callHook('webvue:navigation:start', to)
  await ready
  if (import.meta.client && me.value) await refresh()
  if (error.value && !isLoggedOutError(error.value)) {
    if (isSchemaError(error.value)) {
      console.error('[webvue] /api/v1/me failed schema validation', error.value)
      throw createError({ statusCode: 502, statusMessage: $i18n.t('errors.badPayload'), fatal: true })
    }
    throw createError({ statusCode: 502, statusMessage: $i18n.t('errors.serverUnreachable'), fatal: true })
  }
  if (to.path === '/invite/accept') return
  if (to.path === '/login') {
    if (me.value) return navigateTo('/')
    return
  }
  if (!me.value) return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
  if (!canReachPath(me.value, to.path)) throw createError({ statusCode: 403, statusMessage: $i18n.t('errors.forbidden') })
})
