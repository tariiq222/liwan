import { safeSameAppPath } from '@webvue/ui/app/utils/safeReturnTo'
import { AUTH_PATHS } from '../utils/authPaths'

/** Forgets the signed-in profile and goes to the login page, which returns to the page that was open at that moment. */
export function useSessionEnded() {
  const me = useAdminMe()
  const router = useRouter()
  return () => {
    me.value = null
    const next = safeSameAppPath(router.currentRoute.value.fullPath, AUTH_PATHS)
    return navigateTo({ path: '/login', query: next && next !== '/' ? { next } : {} })
  }
}
