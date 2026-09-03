export default defineNuxtRouteMiddleware(async (to) => {
  const { me, error, ready } = useMe()
  await ready
  if (error.value && !isLoggedOutError(error.value)) {
    throw createError({ statusCode: 502, statusMessage: 'تعذّر الوصول إلى الخادم', fatal: true })
  }
  if (to.path === '/login') {
    if (me.value) return navigateTo('/')
    return
  }
  if (!me.value) return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
})
