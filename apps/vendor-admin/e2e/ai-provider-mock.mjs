// The platform AI configuration of the mock control service: the routes of apps/control-plane/src/ai-provider/http.ts over an in-memory
// setting (two providers, three models, a default and a partly filled grid). Validation is only what the page needs to be exercised:
// the real rules (priced and tested, referential integrity, the file) are covered by the control plane's own tests.
const PRESETS = [
  { id: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://api.openai.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false },
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai_compatible', base_url: 'https://api.deepseek.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false },
  { id: 'ollama', label: 'Ollama (self-hosted)', provider: 'ollama', base_url: null, needs_base_url: true, needs_api_key: false, stream_usage: false, stream_usage_editable: false },
  { id: 'custom', label: 'OpenAI-compatible (custom)', provider: 'openai_compatible', base_url: null, needs_base_url: true, needs_api_key: true, stream_usage: false, stream_usage_editable: true },
]

export const seedAiSetting = () => ({
  revision: 4, margin_bps: 2000, updated_at: '2026-11-10T09:30:00.000Z', updated_by: 'account:1', delivery: 'delivered',
  providers: {
    oai: { preset: 'openai', provider: 'openai', base_url: null, stream_usage: true, key: { configured: true, last4: '6789' } },
    local: { preset: 'ollama', provider: 'ollama', base_url: 'http://ollama:11434', stream_usage: false, key: { configured: false, last4: null } },
  },
  models: {
    mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', cached_input_price: '1.25', output_price: '10', usage_reported: true },
    big: { provider: 'oai', model: 'gpt-5', input_price: '5', cached_input_price: null, output_price: '20', usage_reported: true },
    small: { provider: 'local', model: 'qwen2.5:7b', input_price: null, cached_input_price: null, output_price: null, usage_reported: false },
  },
  routes: { default: 'mid', balanced: { analysis: 'big' }, economical: { standard: 'small' }, best: { writing: 'big', standard: 'big' } },
})

/** The handlers keyed like the control service's apiRoutes; `state.ai` holds the setting, `session(req, res, stepUp)` answers the owner check. */
export function aiProviderRoutes(state, json, owner) {
  const prices = (m, key) => (m[key] === undefined ? null : String(m[key]))
  return {
    'GET /v1/platform/ai-provider': ({ req }, res) => { if (owner(req, res)) json(res, 200, { setting: state.ai }) },
    'GET /v1/platform/ai-provider/presets': ({ req }, res) => { if (owner(req, res)) json(res, 200, { items: PRESETS, total: PRESETS.length }) },
    'POST /v1/platform/ai-provider/models': ({ req, body }, res) => {
      if (!owner(req, res, true)) return
      if (!state.ai?.providers[body.provider]) return json(res, 422, { code: 'unknown_provider' })
      const items = ['gpt-4o', 'gpt-4o-mini', 'gpt-5', 'qwen2.5:7b'].map(id => ({ id }))
      return json(res, 200, { items, total: items.length })
    },
    'POST /v1/platform/ai-provider/test': ({ req, body }, res) => {
      if (!owner(req, res, true)) return
      const model = Object.values(state.ai?.models ?? {}).find(m => m.provider === body.provider && m.model === body.model)
      if (!state.ai?.providers[body.provider]) return json(res, 422, { code: 'unknown_provider' })
      if (model) model.usage_reported = true
      return json(res, 200, { ok: true, latency_ms: 420, usage_reported: true })
    },
    'PATCH /v1/platform/ai-provider': ({ req, body }, res) => {
      if (!owner(req, res, true)) return
      if (!body.routes?.default && state.ai?.routes.default) return json(res, 422, { code: 'default_required' })
      const before = state.ai
      state.ai = {
        revision: (before?.revision ?? 0) + 1, margin_bps: body.margin_bps, updated_at: new Date().toISOString(), updated_by: 'account:1', delivery: body.routes?.default ? 'delivered' : 'incomplete',
        providers: Object.fromEntries(Object.entries(body.providers).map(([id, p]) => {
          const preset = PRESETS.find(item => item.id === p.preset)
          const kept = before?.providers[id]?.preset === p.preset ? before.providers[id].key : { configured: false, last4: null }
          return [id, { preset: p.preset, provider: preset?.provider ?? 'openai', base_url: p.base_url ?? preset?.base_url ?? null, stream_usage: p.stream_usage ?? preset?.stream_usage ?? false, key: p.api_key ? { configured: true, last4: p.api_key.slice(-4) } : kept }]
        })),
        models: Object.fromEntries(Object.entries(body.models).map(([id, m]) => [id, {
          provider: m.provider, model: m.model, input_price: prices(m, 'input_price'), cached_input_price: prices(m, 'cached_input_price'), output_price: prices(m, 'output_price'),
          usage_reported: before?.models[id]?.provider === m.provider && before.models[id].model === m.model && before.models[id].usage_reported,
        }])),
        routes: body.routes,
      }
      return json(res, 200, { setting: state.ai })
    },
  }
}
