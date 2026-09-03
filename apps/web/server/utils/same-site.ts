import type { H3Event } from 'h3'

// These endpoints mint or drop the Odoo session cookie, so a cross-site form POST
// must never reach them. Requiring a JSON body defeats the plain <form> attack
// (a form can only send urlencoded/multipart/text), and Sec-Fetch-Site rejects
// anything a browser labels as coming from another origin. Requests without the
// header (curl, older browsers) still pass — the JSON check carries those.
export function assertSameSiteJson(event: H3Event): void {
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) {
    throw createError({ statusCode: 415, data: { code: 'unsupported_media_type', message: 'JSON only' } })
  }
  const site = getHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    throw createError({ statusCode: 403, data: { code: 'cross_site_request', message: 'cross-site request rejected' } })
  }
}
