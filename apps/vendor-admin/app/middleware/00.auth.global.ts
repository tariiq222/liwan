import { decideAccess } from '../utils/routeAccess'
import { normalizePath } from '../utils/safeReturnTo'

// Every page needs a session and, when it names one, a capability. Public pages (sign-in,
// enrollment) are open; the profile is looked up for the sign-in page only, so enrollment makes
// no request before it has removed the invitation token from the address.
export default defineNuxtRouteMiddleware(async (to) => {
  const isPublic = to.meta.public === true
  const session = useAdminSession()
  if (!isPublic || normalizePath(to.path) === '/login') {
    try {
      await session.ready
    } catch (error) {
      // An unreachable BFF on the sign-in page is shown by its own attempt; anywhere else it is an error page.
      if (!isPublic) throw createError({ statusCode: 503, statusMessage: 'vendor_unavailable', fatal: true, cause: error })
    }
  }
  const access = decideAccess({
    isPublic,
    me: session.me.value,
    fullPath: to.fullPath,
    path: to.path,
    next: to.query.next,
    capability: to.meta.capability,
  })
  if (access.action === 'login') return navigateTo({ path: '/login', query: access.next ? { next: access.next } : {} })
  if (access.action === 'redirect') return navigateTo(access.to)
  if (access.action === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'forbidden', fatal: true })
})
