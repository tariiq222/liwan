import type { H3Event } from 'h3'
import { createError } from 'h3'
import { AiTenantConfigSchema, type AiTenantConfig } from '@liwan/contracts'
import { ownerFor } from './session'
import { forwardUpstream, odooJson, serviceFetch } from './upstream'

/**
 * One call to the tenant's AI configuration in the AI service, for a caller Odoo confirms holds `ai.settings.manage` in
 * the root company (`GET /api/v1/ai/settings`, or `POST /api/v1/ai/config/authorize` for a change; a 403 is forwarded as is). The tenant key travels to the service only, in the
 * body, and is never logged or returned: the service answers with `configured` and the last four characters.
 */
export async function tenantConfig(event: H3Event, method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<AiTenantConfig> {
  // A read needs the settings read; a change needs the write level of the feature too (an expired or downgraded tenant
  // keeps reading but changes nothing), which Odoo answers for the AI service's half of the configuration.
  const allowed = method === 'GET' ? await odooJson(event, 'GET', '/api/v1/ai/settings') : await odooJson(event, 'POST', '/api/v1/ai/config/authorize', { body: {} })
  if (allowed.status !== 200) forwardUpstream(allowed)
  const response = await serviceFetch(event, method, path, await ownerFor(event), body)
  if (response.status === 422) {
    // A refused base URL names itself (`ai_base_url_not_public`) so the page can say why; anything else is a plain `invalid`.
    const refusal = ((await response.json().catch(() => null)) as { detail?: { code?: unknown; field?: unknown } } | null)?.detail
    const field = refusal?.field === 'base_url' ? 'base_url' : undefined
    const code = field && refusal?.code === 'ai_base_url_not_public' ? refusal.code : 'invalid'
    throw createError({ statusCode: 422, data: { code, message: 'the AI service refused the value', ...(field ? { field } : {}) } })
  }
  if (response.status === 503) {
    const detail = ((await response.json().catch(() => null)) as { detail?: string } | null)?.detail
    throw createError({ statusCode: 503, data: { code: detail === 'ai_key_unavailable' ? detail : 'ai_unavailable', message: 'the AI service cannot store this now' } })
  }
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  return AiTenantConfigSchema.parse(await response.json())
}

export function invalidBody(field: string) {
  return createError({ statusCode: 422, data: { code: 'invalid', message: 'invalid request', field } })
}
