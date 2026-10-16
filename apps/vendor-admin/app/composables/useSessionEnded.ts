import { safeReturnTo } from '../utils/safeReturnTo'

/** Forgets the signed-in profile and goes to the login page, which returns to the page that was open at that moment. */
export function useSessionEnded() {
  const me = useAdminMe()
  const router = useRouter()
  return () => {
    me.value = null
    const next = safeReturnTo(router.currentRoute.value.fullPath)
    return navigateTo({ path: '/login', query: next && next !== '/' ? { next } : {} })
  }
}
