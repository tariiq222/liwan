import type { H3Event } from 'h3'
import { createError } from 'h3'
import { AiTenantConfigSchema } from '@liwan/contracts'
import type { RunSession } from './session'
import { serviceFetch } from './upstream'

/** What the AI service enforces on one request: whose provider runs it, whether data may leave the Kingdom, the output cap. */
export type ServicePolicy = { provider_mode: 'platform' | 'tenant_key' | 'setup'; outside_allowed: boolean; max_output_tokens: number | null }

/** Whose provider runs the request: a setup conversation always runs on the platform provider, paid by the setup budget. */
function providerMode(session: RunSession): ServicePolicy['provider_mode'] {
  return session.mode === 'setup' ? 'setup' : session.policy.provider_mode
}

export function runPolicy(session: RunSession): ServicePolicy {
  const { outside_allowed, output_tokens_per_run } = session.policy
  const provider_mode = providerMode(session)
  // The output cap protects the platform's provider account; a tenant on its own key pays its own provider.
  return { provider_mode, outside_allowed, max_output_tokens: provider_mode === 'tenant_key' ? null : output_tokens_per_run }
}

/**
 * Refuses a request the service would refuse, before the message is counted or a write is claimed: a provider outside the
 * Kingdom without a signed consent (403 `ai_consent_required`), or a tenant-key policy without a key (409 `ai_tenant_key_missing`).
 * The service checks both again; this only keeps a refused request from spending the user's quota or running a tool.
 */
export async function assertRunnable(event: H3Event, session: RunSession): Promise<void> {
  const { outside_allowed } = session.policy
  const provider_mode = providerMode(session) === 'tenant_key' ? 'tenant_key' : 'platform'
  if (provider_mode === 'platform' && outside_allowed) return
  const response = await serviceFetch(event, 'GET', '/v1/tenant/config', session.owner)
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  const config = AiTenantConfigSchema.parse(await response.json())
  if (provider_mode === 'tenant_key' && !config.key.configured) {
    throw createError({ statusCode: 409, data: { code: 'ai_tenant_key_missing', message: 'the organization has not set its AI provider key' } })
  }
  const provider = provider_mode === 'platform' ? config.platform.provider : config.key.provider
  const location = config.providers.find(item => item.name === provider)?.location ?? config.platform.location
  if (location === 'outside' && !outside_allowed) {
    throw createError({ statusCode: 403, data: { code: 'ai_consent_required', message: 'the organization has not consented to AI processing outside the Kingdom' } })
  }
}
