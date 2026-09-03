export default defineNuxtRouteMiddleware(async (to) => {
  const { me, ready } = useMe()
  await ready
  if (to.path === '/login') {
    if (me.value) return navigateTo('/')
    return
  }
  if (!me.value) return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
})
