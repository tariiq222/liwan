import { timingSafeEqual } from 'node:crypto'
import { ERROR_REPORT_PATH } from '../../shared/utils/errorReportScrub'

type ProspectConfig = { customerCommercialEnabled?: boolean | string; customerCommercialPublicOrigin?: string; publicSignupEnabled?: boolean | string }

export const SIGNUP_API = /^\/api\/commercial\/signup\/(terms|offer|start|verify-sms|send-email|verify-email)$/
export const isSignupPage = (pathname: string) => /^\/register\/?$/.test(pathname)
/** The marketing site's two public routes: the published pricing and the contact form. Served on the common host whenever the commercial integration is on. */
export const PUBLIC_SITE_API = /^\/api\/commercial\/public\/(pricing|contact)$/
/** "Find my workspace": the page and its relay. They live on the common host only, beside the sign-up they share the human check with. */
export const FIND_WORKSPACE_API = /^\/api\/invitations\/find-workspace$/
export const isFindWorkspacePage = (pathname: string) => /^\/find-workspace\/?$/.test(pathname)
/** The common host serves no sign-in: `/login` there leads to the find page (tenant hosts keep their own `/login`). */
export const isProspectLogin = (pathname: string) => /^\/login\/?$/.test(pathname)
/** The browser reporter's tunnel: the public pages report through it too, and it needs no tenant (its events carry no tenant tag there). */
const isErrorReportPost = (request: { method?: string; pathname: string }) => request.method === 'POST' && request.pathname === ERROR_REPORT_PATH
const PROSPECT_PATHS = [/^\/payment-done\/?$/, /^\/api\/commercial\/payment-callback$/, /^\/_nuxt\//, PUBLIC_SITE_API]

/** The `x-liwan-tenant` value signed for a payment return that arrives on the LiwanOS public host. */
export const PROSPECT_TENANT = 'public'

/**
 * True for a request to the LiwanOS public host (the configured `customerCommercialPublicOrigin`) in shared mode.
 * That host belongs to no tenant: a customer whose first order is paid there has no workspace yet. It still
 * has to come through the shared proxy (token), and only the paths above are served; everything else on this host
 * goes on to the tenant boundary, which refuses it.
 */
export function isProspectRequest(request: { host?: string; method?: string; proxyToken?: string; pathname: string }, config: ProspectConfig): boolean {
  if ((process.env.LIWAN_TENANCY_MODE ?? 'dedicated') !== 'shared') return false
  if (!(config.customerCommercialEnabled === true || config.customerCommercialEnabled === 'true')) return false
  let host: string
  try { host = new URL(config.customerCommercialPublicOrigin ?? '').host.toLowerCase() } catch { return false }
  if (request.host?.toLowerCase() !== host) return false
  const token = process.env.LIWAN_SHARED_PROXY_TOKEN ?? ''
  const supplied = request.proxyToken ?? ''
  if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) return false
  if (isSignupPage(request.pathname) || SIGNUP_API.test(request.pathname) || isFindWorkspacePage(request.pathname) || FIND_WORKSPACE_API.test(request.pathname) || isProspectLogin(request.pathname)) {
    return config.publicSignupEnabled === true || config.publicSignupEnabled === 'true'
  }
  if (isErrorReportPost(request)) return true
  return PROSPECT_PATHS.some(pattern => pattern.test(request.pathname))
}
