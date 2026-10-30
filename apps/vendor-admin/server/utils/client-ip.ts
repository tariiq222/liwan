import { isIP } from 'node:net'
import { getRequestIP, type H3Event } from 'h3'
import { bffConfig } from './config'
import { peerAddress } from './loopback'

/**
 * The real client address, or undefined when it is unknown. A browser-supplied x-liwan-client-ip is
 * never read, and x-forwarded-for is honoured only behind a trusted edge (`trustProxy`).
 */
export function clientIp(event: H3Event): string | undefined {
  const { trustProxy, adminOrigin } = bffConfig(event)
  const address = trustProxy ? getRequestIP(event, { xForwardedFor: true }) : peerAddress(event, adminOrigin.origin)
  return address && isIP(address) ? address : undefined
}
