import { isIP } from 'node:net'
import { getRequestIP, type H3Event } from 'h3'
import { bffConfig } from './config'

/**
 * The real client address, or undefined when it is unknown. A browser-supplied x-webvue-client-ip is
 * never read, and x-forwarded-for is honoured only behind a trusted edge (`trustProxy`).
 */
export function clientIp(event: H3Event): string | undefined {
  const address = getRequestIP(event, { xForwardedFor: bffConfig(event).trustProxy })
  return address && isIP(address) ? address : undefined
}
