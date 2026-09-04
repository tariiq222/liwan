export default defineNuxtRouteMiddleware(async (to) => {
  const { $i18n } = useNuxtApp()
  const { me, error, ready } = useMe()
  await ready
  if (error.value && !isLoggedOutError(error.value)) {
    if (isSchemaError(error.value)) {
      console.error('[nasq] /api/v1/me failed schema validation', error.value)
      throw createError({ statusCode: 502, statusMessage: $i18n.t('errors.badPayload'), fatal: true })
    }
    throw createError({ statusCode: 502, statusMessage: $i18n.t('errors.serverUnreachable'), fatal: true })
  }
  if (to.path === '/login') {
    if (me.value) return navigateTo('/')
    return
  }
  if (!me.value) return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
})
