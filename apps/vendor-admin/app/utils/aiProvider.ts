// The platform AI provider page's vocabulary: the request bodies the form builds and the message each failure shows.
import type { AiProviderCurrent, AiProviderPreset } from '@liwan/commercial-contracts'
import { StepUpCancelled } from '../composables/useStepUp'

export interface ProbeFields { preset: string, base_url?: string, api_key?: string, stream_usage?: boolean }
export interface SaveFields extends ProbeFields { model: string, reason: string }
export interface ProviderDraft { preset: string, base_url: string, api_key: string, model: string, stream_usage: boolean }

const filled = (value: string): string | undefined => (value.trim() ? value.trim() : undefined)

/** The fields of a models, test or save call: the endpoint only for a preset that takes one, the key only when typed (the stored key is used otherwise), the token-count option only where the vendor may choose it. */
export function probeFields(draft: ProviderDraft, preset: AiProviderPreset | undefined): ProbeFields {
  return {
    preset: draft.preset,
    ...(preset?.needs_base_url && filled(draft.base_url) ? { base_url: filled(draft.base_url) } : {}),
    ...(preset?.needs_api_key && filled(draft.api_key) ? { api_key: filled(draft.api_key) } : {}),
    ...(preset?.stream_usage_editable ? { stream_usage: draft.stream_usage } : {}),
  }
}

/** Whether the server already holds a key that applies to what the form chose: same preset, and the same endpoint when the endpoint is the vendor's. */
export function storedKeyApplies(setting: AiProviderCurrent['setting'], draft: ProviderDraft, preset: AiProviderPreset | undefined): boolean {
  if (!setting?.key.configured || !preset?.needs_api_key || setting.preset !== draft.preset) return false
  return !preset.needs_base_url || setting.base_url === (filled(draft.base_url)?.replace(/\/+$/, '') ?? null)
}

/** The form can be tested or saved: a preset, its endpoint when it needs one, a key typed or stored when it needs one, and a model. */
export function draftComplete(draft: ProviderDraft, preset: AiProviderPreset | undefined, keyStored: boolean): boolean {
  if (!preset || !draft.model.trim()) return false
  if (preset.needs_base_url && !filled(draft.base_url)) return false
  return !preset.needs_api_key || Boolean(filled(draft.api_key)) || keyStored
}

/** What a passed test vouches for: change any of it and the test must run again before saving. */
export const testSignature = (draft: ProviderDraft): string => JSON.stringify([draft.preset, draft.base_url.trim(), draft.api_key, draft.model.trim(), draft.stream_usage])

const CODES = new Set([
  'invalid', 'invalid_preset', 'invalid_base_url', 'invalid_stream_usage', 'api_key_required', 'api_key_not_allowed', 'secret_key_unavailable', 'provider_file_unavailable',
  'provider_unauthorized', 'provider_endpoint_refused', 'provider_unreachable', 'provider_timeout', 'provider_rate_limited', 'provider_error', 'provider_invalid_response', 'forbidden', 'step_up_required',
])

/** Which message a failed call shows. A cancelled step-up is not an error of the call itself. */
export function aiProviderErrorKey(error: unknown): string {
  if (error instanceof StepUpCancelled) return 'aiProvider.errors.stepUpCancelled'
  const e = error as { statusCode?: number, response?: { status?: number }, data?: { code?: string } } | null
  const code = e?.data?.code
  if (code && CODES.has(code)) return `aiProvider.errors.${code}`
  const status = e?.statusCode ?? e?.response?.status
  if (status === 503) return 'aiProvider.errors.unavailable'
  return 'aiProvider.errors.generic'
}
