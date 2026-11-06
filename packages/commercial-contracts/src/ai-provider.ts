import { z } from 'zod'

// The vendor's choice of the platform AI provider (spec 2026-11-04 §6.13): wire shapes of /v1/platform/ai-provider*.
// The control plane builds every response through these schemas and the vendor-admin BFF parses with the same ones.
// The API key is write-only: it appears in a request, never in a response (only `configured` and the last four characters).

/** The AI service's own provider names (apps/ai-service provider_registry.py). */
export const aiProviderNameSchema = z.enum(['anthropic', 'openai', 'ollama', 'openrouter', 'openai_compatible'])
export type AiProviderName = z.infer<typeof aiProviderNameSchema>

const presetId = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)
const modelId = z.string().min(1).max(128).regex(/^[^\p{Cc}]+$/u)
const baseUrl = z.string().min(1).max(512)
const apiKey = z.string().min(8).max(512).regex(/^[\x21-\x7e]+$/)  // printable ASCII, no spaces: the form real provider keys have
const instant = z.iso.datetime()

export const aiProviderPresetSchema = z.strictObject({
  id: presetId,
  label: z.string(),
  provider: aiProviderNameSchema,
  /** The fixed endpoint, or null when the vendor gives it (self-hosted Ollama, a custom endpoint). */
  base_url: baseUrl.nullable(),
  needs_base_url: z.boolean(),
  needs_api_key: z.boolean(),
  /** Whether the provider's stream is asked for token counts (`stream_options.include_usage`); token limits and cost depend on it. */
  stream_usage: z.boolean(),
  /** The vendor may tick it (a custom endpoint); for the other presets the catalog decides. */
  stream_usage_editable: z.boolean(),
})
export const aiProviderPresetListSchema = z.strictObject({ items: z.array(aiProviderPresetSchema), total: z.number().int().min(0) })

/** `delivered`: the file the AI service reads holds this revision; `pending`: it does not (yet); `unconfigured`: the control plane has no file to write. */
export const aiProviderDeliverySchema = z.enum(['delivered', 'pending', 'unconfigured'])

export const aiProviderSettingSchema = z.strictObject({
  preset: presetId,
  provider: aiProviderNameSchema,
  model: modelId,
  base_url: baseUrl.nullable(),
  stream_usage: z.boolean(),
  key: z.strictObject({ configured: z.boolean(), last4: z.string().length(4).nullable() }),
  revision: z.number().int().min(1),
  updated_at: instant,
  updated_by: z.string(),
  delivery: aiProviderDeliverySchema,
})
export const aiProviderCurrentSchema = z.strictObject({ setting: aiProviderSettingSchema.nullable() })

/** Both calls below take the key to try; without one they use the stored key, but only for the stored preset and endpoint. */
const probeFields = { preset: presetId, base_url: baseUrl.optional(), api_key: apiKey.optional() }
export const aiProviderModelsRequestSchema = z.strictObject(probeFields)
/** `stream_usage`: what the test asks the provider's stream for; absent, the preset's own default. */
const usageField = { stream_usage: z.boolean().optional() }
export const aiProviderModelsSchema = z.strictObject({ items: z.array(z.strictObject({ id: modelId })), total: z.number().int().min(0) })

export const AI_PROVIDER_TEST_FAILURES = ['key_missing', 'unauthorized', 'model_not_found', 'rate_limited', 'stream_usage_refused', 'endpoint_refused', 'timeout', 'unreachable', 'provider_error', 'invalid_response', 'bad_request'] as const
export const aiProviderTestFailureSchema = z.enum(AI_PROVIDER_TEST_FAILURES)
export type AiProviderTestFailure = z.infer<typeof aiProviderTestFailureSchema>
export const aiProviderTestRequestSchema = z.strictObject({ ...probeFields, ...usageField, model: modelId })
export const aiProviderTestResultSchema = z.discriminatedUnion('ok', [
  /** `usage_reported`: the reply carried token counts; without them the token limits cannot be enforced for this provider. */
  z.strictObject({ ok: z.literal(true), latency_ms: z.number().int().min(0), usage_reported: z.boolean() }),
  z.strictObject({ ok: z.literal(false), code: aiProviderTestFailureSchema }),
])

export const aiProviderSaveSchema = z.strictObject({ ...probeFields, ...usageField, model: modelId, reason: z.string().trim().min(3).max(1000) })

export type AiProviderPreset = z.infer<typeof aiProviderPresetSchema>
export type AiProviderPresetList = z.infer<typeof aiProviderPresetListSchema>
export type AiProviderSetting = z.infer<typeof aiProviderSettingSchema>
export type AiProviderCurrent = z.infer<typeof aiProviderCurrentSchema>
export type AiProviderModels = z.infer<typeof aiProviderModelsSchema>
export type AiProviderTestResult = z.infer<typeof aiProviderTestResultSchema>
export type AiProviderSave = z.infer<typeof aiProviderSaveSchema>
