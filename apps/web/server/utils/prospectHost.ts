import { timingSafeEqual } from 'node:crypto'

type ProspectConfig = { customerCommercialEnabled?: boolean | string; customerCommercialPublicOrigin?: string }

/** What the LiwanOS public host serves: the payment-done page, the payment return relay and the built assets they need. */
const PROSPECT_PATHS = [/^\/payment-done\/?$/, /^\/api\/commercial\/payment-callback$/, /^\/_nuxt\//]

/** The `x-liwan-tenant` value signed for a payment return that arrives on the LiwanOS public host. */
export const PROSPECT_TENANT = 'public'

/**
 * True for a request to the LiwanOS public host (the configured `customerCommercialPublicOrigin`) in shared mode.
 * That host belongs to no tenant: a customer whose first order is paid there has no workspace yet. It still
 * has to come through the shared proxy (token), and only the paths above are served; everything else on this host
 * goes on to the tenant boundary, which refuses it.
 */
export function isProspectRequest(request: { host?: string; proxyToken?: string; pathname: string }, config: ProspectConfig): boolean {
  if ((process.env.LIWAN_TENANCY_MODE ?? 'dedicated') !== 'shared') return false
  if (!(config.customerCommercialEnabled === true || config.customerCommercialEnabled === 'true')) return false
  let host: string
  try { host = new URL(config.customerCommercialPublicOrigin ?? '').host.toLowerCase() } catch { return false }
  if (request.host?.toLowerCase() !== host) return false
  const token = process.env.LIWAN_SHARED_PROXY_TOKEN ?? ''
  const supplied = request.proxyToken ?? ''
  if (token.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) return false
  return PROSPECT_PATHS.some(pattern => pattern.test(request.pathname))
}
