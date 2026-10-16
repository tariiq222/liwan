import { getHeader, getMethod, type H3Event } from 'h3'
import { bffConfig } from './config'
import { bffFail } from './errors'

/** Every non-GET request must be same-origin JSON from this app's own origin. */
export function assertSameOrigin(event: H3Event): void {
  const method = getMethod(event).toUpperCase()
  if (method === 'GET' || method === 'HEAD') return
  const { adminOrigin } = bffConfig(event)
  const contentType = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') bffFail(415, 'unsupported_media_type')
  const site = getHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') bffFail(403, 'cross_site_request')
  if (getHeader(event, 'origin') !== adminOrigin.origin) bffFail(403, 'cross_site_request')
}
