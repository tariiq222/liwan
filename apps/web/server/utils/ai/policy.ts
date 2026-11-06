import type { H3Event } from 'h3'
import { createError } from 'h3'
import { AiTenantConfigSchema } from '@liwan/contracts'
import type { RunSession } from './session'
import { serviceFetch } from './upstream'

/** What the AI service enforces on one request: whose provider runs it, whether the tenant signed the AI acknowledgement, the output cap. */
export type ServicePolicy = { provider_mode: 'platform' | 'tenant_key' | 'setup'; consent_signed: boolean; max_output_tokens: number | null }

/** Whose provider runs the request: a setup or help conversation always runs on the platform provider, paid by the assistance budget. */
function providerMode(session: RunSession): ServicePolicy['provider_mode'] {
  return session.mode === 'assistant' ? session.policy.provider_mode : 'setup'
}

export function runPolicy(session: RunSession): ServicePolicy {
  const { consent_signed, output_tokens_per_run } = session.policy
  const provider_mode = providerMode(session)
  // The output cap protects the platform's provider account; a tenant on its own key pays its own provider.
  return { provider_mode, consent_signed, max_output_tokens: provider_mode === 'tenant_key' ? null : output_tokens_per_run }
}

/**
 * Refuses a request the service would refuse, before the message is counted or a write is claimed: any request of a tenant
 * that has not signed the current AI acknowledgement (403 `ai_consent_required`, whatever the provider, spec 2026-11-04 §6.8),
 * or a tenant-key policy without a key (409 `ai_tenant_key_missing`). The service checks both again; this only keeps a refused
 * request from spending the user's quota or running a tool.
 */
export async function assertRunnable(event: H3Event, session: RunSession): Promise<void> {
  if (!session.policy.consent_signed) {
    throw createError({ statusCode: 403, data: { code: 'ai_consent_required', message: 'the organization has not signed the AI acknowledgement' } })
  }
  if (providerMode(session) !== 'tenant_key') return
  const response = await serviceFetch(event, 'GET', '/v1/tenant/config', session.owner)
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: `AI service status ${response.status}` } })
  const config = AiTenantConfigSchema.parse(await response.json())
  if (!config.key.configured) {
    throw createError({ statusCode: 409, data: { code: 'ai_tenant_key_missing', message: 'the organization has not set its AI provider key' } })
  }
}
