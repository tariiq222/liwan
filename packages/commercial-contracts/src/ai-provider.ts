import { z } from 'zod'

// The vendor's platform AI configuration (specs 2026-11-04 §6.13, 2026-11-10 §5.5): providers, priced models, a margin and a map from
// quality level and capability to model. Wire shapes of /v1/platform/ai-provider*.
// The control plane builds every response through these schemas and the vendor-admin BFF parses with the same ones.
// An API key is write-only: it appears in a request, never in a response (only `configured` and the last four characters per provider).

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

/** The four kinds of task the AI service routes by (apps/ai-service contracts.py `Capability`) and the three quality levels a tenant chooses from (`Quality`). */
export const AI_CAPABILITIES = ['quick', 'standard', 'analysis', 'writing'] as const
export const aiCapabilitySchema = z.enum(AI_CAPABILITIES)
export type AiCapability = z.infer<typeof aiCapabilitySchema>
export const AI_QUALITY_LEVELS = ['economical', 'balanced', 'best'] as const
export const aiQualitySchema = z.enum(AI_QUALITY_LEVELS)
export type AiQuality = z.infer<typeof aiQualitySchema>

/** The id of a provider or a model of the configuration: the rule the file the AI service reads gives its ids. */
export const aiConfigIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)

export const AI_UNITS_PER_USD = 100_000  // one cost unit is 0.00001 USD (apps/ai-service usage.py `price_units`)
export const AI_MAX_UNITS = 2_147_483_647
/** A price in USD per million tokens as a plain decimal with at most five decimals, so it is a whole number of cost units, within the shared maximum. */
export const aiPriceSchema = z.string().regex(/^[0-9]{1,9}(\.[0-9]{1,5})?$/).refine((price) => {
  const [whole, fraction = ''] = price.split('.')
  return Number(whole) * AI_UNITS_PER_USD + Number(fraction.padEnd(5, '0')) <= AI_MAX_UNITS
}, 'a price is above the shared maximum')

const MAX_PROVIDERS = 16
const MAX_MODELS = 64
const routeCell = z.strictObject({ quick: aiConfigIdSchema.optional(), standard: aiConfigIdSchema.optional(), analysis: aiConfigIdSchema.optional(), writing: aiConfigIdSchema.optional() })
/** `default` serves every capability without an entry; a quality level's cell may leave a capability out and then the balanced cell, then the default, serves it. */
export const aiRoutesSchema = z.strictObject({ default: aiConfigIdSchema.optional(), economical: routeCell.optional(), balanced: routeCell.optional(), best: routeCell.optional() })
export type AiRoutes = z.infer<typeof aiRoutesSchema>
const marginBps = z.number().int().min(0).max(10_000)

/** `delivered`: the file the AI service reads holds this revision; `pending`: it does not (yet); `unconfigured`: the control plane has no file to write; `incomplete`: no default model is routed, so there is nothing to write. */
export const aiProviderDeliverySchema = z.enum(['delivered', 'pending', 'unconfigured', 'incomplete'])

const keyState = z.strictObject({ configured: z.boolean(), last4: z.string().length(4).nullable() })
export const aiProviderEntrySchema = z.strictObject({
  preset: presetId,
  provider: aiProviderNameSchema,
  base_url: baseUrl.nullable(),
  stream_usage: z.boolean(),
  key: keyState,
})
export const aiModelEntrySchema = z.strictObject({
  /** The id of a provider of this configuration. */
  provider: aiConfigIdSchema,
  /** The model's name at that provider. */
  model: modelId,
  input_price: aiPriceSchema.nullable(),
  cached_input_price: aiPriceSchema.nullable(),
  output_price: aiPriceSchema.nullable(),
  /** The last successful test of this model on its provider saw token counts; a model is routed for charged use only when it did. */
  usage_reported: z.boolean(),
})
export const aiProviderSettingSchema = z.strictObject({
  revision: z.number().int().min(1),
  margin_bps: marginBps,
  providers: z.record(aiConfigIdSchema, aiProviderEntrySchema),
  models: z.record(aiConfigIdSchema, aiModelEntrySchema),
  routes: aiRoutesSchema,
  updated_at: instant,
  updated_by: z.string(),
  delivery: aiProviderDeliverySchema,
})
export const aiProviderCurrentSchema = z.strictObject({ setting: aiProviderSettingSchema.nullable() })

const count = (max: number) => (record: Record<string, unknown>) => Object.keys(record).length <= max

/** The save takes the whole configuration. A provider's key is optional: without one the stored key stays, but only while the preset and endpoint are the same. */
export const aiProviderInputSchema = z.strictObject({ preset: presetId, base_url: baseUrl.optional(), api_key: apiKey.optional(), stream_usage: z.boolean().optional() })
export const aiModelInputSchema = z.strictObject({
  provider: aiConfigIdSchema, model: modelId, input_price: aiPriceSchema.optional(), cached_input_price: aiPriceSchema.optional(), output_price: aiPriceSchema.optional(),
})
export const aiProviderSaveSchema = z.strictObject({
  margin_bps: marginBps,
  providers: z.record(aiConfigIdSchema, aiProviderInputSchema).refine(count(MAX_PROVIDERS), `at most ${MAX_PROVIDERS} providers`),
  models: z.record(aiConfigIdSchema, aiModelInputSchema).refine(count(MAX_MODELS), `at most ${MAX_MODELS} models`),
  routes: aiRoutesSchema,
  reason: z.string().trim().min(3).max(1000),
})

/** Both calls below use a saved provider and its stored key; a models call lists what the provider offers, a test makes one small completion with a model of it. */
export const aiProviderModelsRequestSchema = z.strictObject({ provider: aiConfigIdSchema })
export const aiProviderModelsSchema = z.strictObject({ items: z.array(z.strictObject({ id: modelId })), total: z.number().int().min(0) })

export const AI_PROVIDER_TEST_FAILURES = ['key_missing', 'unauthorized', 'model_not_found', 'rate_limited', 'stream_usage_refused', 'endpoint_refused', 'timeout', 'unreachable', 'provider_error', 'invalid_response', 'bad_request'] as const
export const aiProviderTestFailureSchema = z.enum(AI_PROVIDER_TEST_FAILURES)
export type AiProviderTestFailure = z.infer<typeof aiProviderTestFailureSchema>
export const aiProviderTestRequestSchema = z.strictObject({ provider: aiConfigIdSchema, model: modelId })
export const aiProviderTestResultSchema = z.discriminatedUnion('ok', [
  /** `usage_reported`: the reply carried token counts; without them the model cannot be routed for charged use. A test of a saved model records it. */
  z.strictObject({ ok: z.literal(true), latency_ms: z.number().int().min(0), usage_reported: z.boolean() }),
  z.strictObject({ ok: z.literal(false), code: aiProviderTestFailureSchema }),
])

export type AiProviderPreset = z.infer<typeof aiProviderPresetSchema>
export type AiProviderPresetList = z.infer<typeof aiProviderPresetListSchema>
export type AiProviderEntry = z.infer<typeof aiProviderEntrySchema>
export type AiModelEntry = z.infer<typeof aiModelEntrySchema>
export type AiProviderSetting = z.infer<typeof aiProviderSettingSchema>
export type AiProviderCurrent = z.infer<typeof aiProviderCurrentSchema>
export type AiProviderModels = z.infer<typeof aiProviderModelsSchema>
export type AiProviderTestResult = z.infer<typeof aiProviderTestResultSchema>
export type AiProviderSave = z.infer<typeof aiProviderSaveSchema>
