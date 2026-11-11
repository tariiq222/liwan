import { appendResponseHeader, getRequestProtocol, type H3Event } from 'h3'

export function authCookiesAreSecure(event: H3Event, upstreamHeaders: Record<string, string>) {
  // Shared requests have crossed the authenticated HTTPS-only tenant boundary.
  // Dedicated proxy protocols come from the already validated private edge identity.
  return process.env.LIWAN_TENANCY_MODE === 'shared'
    || upstreamHeaders['x-liwan-client-proto'] === 'https'
    || upstreamHeaders['x-forwarded-proto'] === 'https'
    || getRequestProtocol(event, { xForwardedProto: false }) === 'https'
}

export function forwardAuthCookies(event: H3Event, headers: Headers, secure: boolean) {
  for (const cookie of headers.getSetCookie()) {
    const alreadySecure = /;\s*secure\s*(?:;|$)/i.test(cookie)
    const hasSameSite = /;\s*samesite=/i.test(cookie)
    appendResponseHeader(event, 'set-cookie', `${cookie}${secure && !alreadySecure ? '; Secure' : ''}${hasSameSite ? '' : '; SameSite=Lax'}`)
  }
}
