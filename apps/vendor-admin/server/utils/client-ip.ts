import { getRequestIP, type H3Event } from 'h3'
import { bffConfig } from './config'

const ADDRESS = /^[0-9a-fA-F:.]{1,64}$/

/**
 * The real client address, or undefined when it is unknown. A browser-supplied x-nasq-client-ip is
 * never read, and x-forwarded-for is honoured only behind a trusted edge (`trustProxy`).
 */
export function clientIp(event: H3Event): string | undefined {
  const address = getRequestIP(event, { xForwardedFor: bffConfig(event).trustProxy })
  return address && ADDRESS.test(address) ? address : undefined
}
