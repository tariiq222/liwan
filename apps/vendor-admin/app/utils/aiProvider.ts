// The platform AI page's vocabulary: the draft the form edits, the rules that decide what a model may serve, and the message each failure shows.
import {
  AI_CAPABILITIES, AI_QUALITY_LEVELS, aiConfigIdSchema, aiPriceSchema, type AiCapability, type AiProviderCurrent, type AiProviderPreset, type AiProviderSave, type AiQuality,
} from '@liwan/commercial-contracts'
import { StepUpCancelled } from '../composables/useStepUp'

export { AI_CAPABILITIES, AI_QUALITY_LEVELS }
export type Setting = NonNullable<AiProviderCurrent['setting']>

/** `api_key` is typed once and sent once: it is cleared as soon as a save succeeds. */
export interface ProviderDraft { id: string, preset: string, base_url: string, api_key: string, stream_usage: boolean }
export interface ModelDraft { id: string, provider: string, model: string, input_price: string, cached_input_price: string, output_price: string }
/** A route cell holds a model id, or '' to inherit. */
export interface RouteDraft { default: string, cells: Record<`${AiQuality}.${AiCapability}`, string> }
export interface ConfigDraft { providers: ProviderDraft[], models: ModelDraft[], margin_percent: string, routes: RouteDraft }

export const cellKey = (quality: AiQuality, capability: AiCapability) => `${quality}.${capability}` as const
export const emptyRoutes = (): RouteDraft => ({ default: '', cells: Object.fromEntries(AI_QUALITY_LEVELS.flatMap(q => AI_CAPABILITIES.map(c => [cellKey(q, c), '']))) as RouteDraft['cells'] })
export const emptyConfig = (): ConfigDraft => ({ providers: [], models: [], margin_percent: '20', routes: emptyRoutes() })

const BPS_PER_PERCENT = 100
const percentOfBps = (bps: number) => String(bps / BPS_PER_PERCENT)

/** The draft that shows a saved configuration; no key is ever in it. */
export function draftFromSetting(setting: Setting | null): ConfigDraft {
  if (!setting) return emptyConfig()
  const routes = emptyRoutes()
  routes.default = setting.routes.default ?? ''
  for (const quality of AI_QUALITY_LEVELS) for (const capability of AI_CAPABILITIES) routes.cells[cellKey(quality, capability)] = setting.routes[quality]?.[capability] ?? ''
  return {
    margin_percent: percentOfBps(setting.margin_bps), routes,
    providers: Object.entries(setting.providers).map(([id, p]) => ({ id, preset: p.preset, base_url: p.base_url ?? '', api_key: '', stream_usage: p.stream_usage })),
    models: Object.entries(setting.models).map(([id, m]) => ({ id, provider: m.provider, model: m.model, input_price: m.input_price ?? '', cached_input_price: m.cached_input_price ?? '', output_price: m.output_price ?? '' })),
  }
}

/** The margin in basis points from a percentage typed with at most two decimals, or null when it is not one. */
export function marginBps(percent: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(percent.trim())) return null
  const bps = Math.round(Number(percent) * BPS_PER_PERCENT)
  return bps <= 10_000 ? bps : null
}

/** What a customer is charged, in USD, for a call that costs the vendor 1.00 USD (the charge is the cost plus the margin). */
export const chargeForOneDollar = (bps: number): string => ((10_000 + bps) / 10_000).toFixed(4).replace(/0{1,2}$/, '')

export const priceFilled = (price: string) => price.trim() !== ''
export const priceValid = (price: string) => !priceFilled(price) || aiPriceSchema.safeParse(price.trim()).success
export const idValid = (id: string) => aiConfigIdSchema.safeParse(id).success

const savedModel = (setting: Setting | null, model: ModelDraft) => {
  const stored = setting?.models[model.id]
  return stored && stored.provider === model.provider && stored.model === model.model ? stored : null
}
const cleanEndpoint = (url: string) => url.trim().replace(/\/+$/, '')
/** The endpoint the form holds is the stored one: compared only for a preset whose endpoint the vendor types (the others have the catalog's). */
function sameEndpoint(stored: Setting['providers'][string], provider: ProviderDraft, presets: AiProviderPreset[]): boolean {
  return !presets.find(p => p.id === provider.preset)?.needs_base_url || (stored.base_url ?? '') === cleanEndpoint(provider.base_url)
}
/** The provider as the server holds it: same id, preset and endpoint, and no key waiting to be saved. */
export function providerSaved(setting: Setting | null, provider: ProviderDraft, presets: AiProviderPreset[]): boolean {
  const stored = setting?.providers[provider.id]
  return Boolean(stored) && stored!.preset === provider.preset && sameEndpoint(stored!, provider, presets) && !provider.api_key
}
/** Whether the model, as drafted, is the one the server holds (so a test of it records its result). */
export const modelSaved = (setting: Setting | null, model: ModelDraft) => savedModel(setting, model) !== null
/** A model serves charged runs only when it has input and output prices and its last test saw token counts. */
export function modelUsable(setting: Setting | null, model: ModelDraft): boolean {
  return Boolean(savedModel(setting, model)?.usage_reported) && priceFilled(model.input_price) && priceFilled(model.output_price) && priceValid(model.input_price) && priceValid(model.output_price)
}
export type UnusableReason = 'unsaved' | 'untested' | 'unpriced'
export function unusableReason(setting: Setting | null, model: ModelDraft): UnusableReason | null {
  if (!modelSaved(setting, model)) return 'unsaved'
  if (!priceFilled(model.input_price) || !priceFilled(model.output_price)) return 'unpriced'
  return savedModel(setting, model)!.usage_reported ? null : 'untested'
}

/** The model a cell runs on: its own, else the balanced column's, else the default; '' when nothing is routed. */
export function effectiveModel(routes: RouteDraft, quality: AiQuality, capability: AiCapability): string {
  return routes.cells[cellKey(quality, capability)] || routes.cells[cellKey('balanced', capability)] || routes.default
}
/** Help, setup, titles and classification run on balanced `quick`; unmapped, they fall to the default model. */
export const quickUnmapped = (routes: RouteDraft) => !routes.cells[cellKey('balanced', 'quick')]

/** The models that use a provider: it cannot be removed while any does. */
export const modelsOfProvider = (draft: ConfigDraft, providerId: string) => draft.models.filter(m => m.provider === providerId).map(m => m.id)

/** The ids no provider or model may share within its own list, and the shape every id must have. */
export function idProblem(ids: string[], id: string): 'invalid' | 'duplicate' | null {
  if (!idValid(id)) return 'invalid'
  return ids.filter(other => other === id).length > 1 ? 'duplicate' : null
}

export type Blocker = 'noProviders' | 'providerId' | 'providerKey' | 'providerEndpoint' | 'modelId' | 'modelName' | 'modelProvider' | 'price' | 'margin'
/** What stops a save before it is sent; the first one is shown next to the button. */
export function saveBlockers(draft: ConfigDraft, setting: Setting | null, presets: AiProviderPreset[]): Blocker[] {
  const found = new Set<Blocker>()
  if (!draft.providers.length) found.add('noProviders')
  const providerIds = draft.providers.map(p => p.id)
  for (const provider of draft.providers) {
    const preset = presets.find(p => p.id === provider.preset)
    if (idProblem(providerIds, provider.id)) found.add('providerId')
    if (preset?.needs_base_url && !provider.base_url.trim()) found.add('providerEndpoint')
    const stored = setting?.providers[provider.id]
    const keptKey = Boolean(stored?.key.configured) && stored!.preset === provider.preset && sameEndpoint(stored!, provider, presets)
    if (preset?.needs_api_key && !provider.api_key.trim() && !keptKey) found.add('providerKey')
  }
  const modelIds = draft.models.map(m => m.id)
  for (const model of draft.models) {
    if (idProblem(modelIds, model.id)) found.add('modelId')
    if (!model.model.trim()) found.add('modelName')
    if (!providerIds.includes(model.provider)) found.add('modelProvider')
    if (![model.input_price, model.cached_input_price, model.output_price].every(priceValid)) found.add('price')
  }
  if (marginBps(draft.margin_percent) === null) found.add('margin')
  return [...found]
}

/** The body of the one save. A key is sent only when typed; an endpoint only for a preset that takes one; the token-count option only where the vendor may choose it. */
export function savePayload(draft: ConfigDraft, presets: AiProviderPreset[], reason: string): AiProviderSave {
  const cell = (quality: AiQuality) => Object.fromEntries(AI_CAPABILITIES.flatMap(c => (draft.routes.cells[cellKey(quality, c)] ? [[c, draft.routes.cells[cellKey(quality, c)]]] : [])))
  const routes: AiProviderSave['routes'] = { ...(draft.routes.default ? { default: draft.routes.default } : {}) }
  for (const quality of AI_QUALITY_LEVELS) { const cells = cell(quality); if (Object.keys(cells).length) routes[quality] = cells }
  const optional = (price: string) => (priceFilled(price) ? price.trim() : undefined)
  return {
    margin_bps: marginBps(draft.margin_percent) ?? 0,
    providers: Object.fromEntries(draft.providers.map((p) => {
      const preset = presets.find(item => item.id === p.preset)
      return [p.id, {
        preset: p.preset,
        ...(preset?.needs_base_url && p.base_url.trim() ? { base_url: p.base_url.trim() } : {}),
        ...(preset?.needs_api_key && p.api_key.trim() ? { api_key: p.api_key.trim() } : {}),
        ...(preset?.stream_usage_editable ? { stream_usage: p.stream_usage } : {}),
      }]
    })),
    models: Object.fromEntries(draft.models.map(m => [m.id, {
      provider: m.provider, model: m.model.trim(),
      ...(optional(m.input_price) ? { input_price: optional(m.input_price) } : {}), ...(optional(m.cached_input_price) ? { cached_input_price: optional(m.cached_input_price) } : {}),
      ...(optional(m.output_price) ? { output_price: optional(m.output_price) } : {}),
    }])),
    routes, reason: reason.trim(),
  }
}

/** A draft id that no other provider uses, from a preset id (`groq`, `groq2`, ...). */
export function freeId(base: string, taken: string[]): string {
  const stem = base.replace(/[^a-z0-9_-]/g, '').slice(0, 28) || 'p'
  if (!taken.includes(stem)) return stem
  for (let n = 2; ; n += 1) if (!taken.includes(`${stem}${n}`)) return `${stem}${n}`
}

/** True when the drafted configuration differs from the saved one, or a key is waiting. */
export const configDirty = (draft: ConfigDraft, setting: Setting | null) =>
  JSON.stringify(draft) !== JSON.stringify(draftFromSetting(setting)) || draft.providers.some(p => p.api_key !== '')

const CODES = new Set([
  'invalid', 'invalid_preset', 'invalid_base_url', 'invalid_base_url_port', 'invalid_stream_usage', 'api_key_required', 'api_key_not_allowed', 'secret_key_unavailable', 'provider_file_unavailable',
  'unknown_provider', 'unknown_model', 'model_not_priced', 'model_not_tested', 'default_required',
  'provider_unauthorized', 'provider_endpoint_refused', 'provider_unreachable', 'provider_timeout', 'provider_rate_limited', 'provider_error', 'provider_invalid_response', 'forbidden', 'step_up_required',
])
export type Section = 'providers' | 'models' | 'routes' | 'general'
const SECTION_OF: Record<string, Section> = {
  invalid_preset: 'providers', invalid_base_url: 'providers', invalid_base_url_port: 'providers', invalid_stream_usage: 'providers', api_key_required: 'providers', api_key_not_allowed: 'providers',
  unknown_provider: 'models', model_not_priced: 'routes', model_not_tested: 'routes', unknown_model: 'routes', default_required: 'routes',
}

function codeOf(error: unknown): string | undefined {
  return (error as { data?: { code?: string } } | null)?.data?.code
}
/** Which message a failed call shows. A cancelled step-up is not an error of the call itself. */
export function aiProviderErrorKey(error: unknown): string {
  if (error instanceof StepUpCancelled) return 'aiProvider.errors.stepUpCancelled'
  const code = codeOf(error)
  if (code && CODES.has(code)) return `aiProvider.errors.${code}`
  const e = error as { statusCode?: number, response?: { status?: number } } | null
  if ((e?.statusCode ?? e?.response?.status) === 503) return 'aiProvider.errors.unavailable'
  return 'aiProvider.errors.generic'
}
/** The part of the page a failure belongs to, so the message sits next to the field it concerns. */
export const aiProviderErrorSection = (error: unknown): Section => SECTION_OF[codeOf(error) ?? ''] ?? 'general'

/** A value inside running text that must keep its own direction (an id, a model name, a price, a number): wrapped in left-to-right isolates. */
export const ltr = (value: string | number): string => `\u2066${value}\u2069`
