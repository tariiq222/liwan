/** Forgets the signed-in profile and goes to the login page, which returns here after the next sign-in. */
export function useSessionEnded() {
  const me = useAdminMe()
  const route = useRoute()
  return () => {
    me.value = null
    return navigateTo({ path: '/login', query: { next: route.fullPath } })
  }
}
