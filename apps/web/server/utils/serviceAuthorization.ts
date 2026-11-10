/**
 * The one request that may carry an `Authorization` header to Odoo: the AI usage report, sent by this server with the
 * deployment's recorder key (issue #557). Every other request has the header stripped, at the Nuxt hop (`tenantTransport`)
 * and at the shared guard (`deploy/shared/guard.mjs`). The match is exact on purpose: the raw request target, with no
 * query, no trailing slash, no other case and no dot segment, and the POST method only.
 */
export const SERVICE_AUTHORIZED_PATH = '/api/v1/ai/usage/service'

export function isServiceAuthorizedRequest(method: string | undefined, target: string | undefined): boolean {
  return method === 'POST' && target === SERVICE_AUTHORIZED_PATH
}

/** The shape of an Odoo API key (hex), as a bearer credential; anything else is not forwarded. */
export const BEARER_KEY = /^Bearer [0-9a-f]{32,128}$/
