import { describe, expect, it } from 'vitest'
import { aiProviderSaveSchema, type AiProviderPreset } from '@liwan/commercial-contracts'
import { StepUpCancelled } from '../../composables/useStepUp'
import {
  aiProviderErrorKey, aiProviderErrorSection, chargeForOneDollar, configDirty, draftFromSetting, effectiveModel, emptyConfig, freeId, marginBps, modelUsable, modelsOfProvider, quickUnmapped,
  ltr, providerSaved, saveBlockers, savePayload, unusableReason, type ConfigDraft, type ProviderDraft, type Setting,
} from '../aiProvider'

const openai: AiProviderPreset = { id: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://llm-a.example.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false }
const custom: AiProviderPreset = { id: 'custom', label: 'Custom', provider: 'openai_compatible', base_url: null, needs_base_url: true, needs_api_key: true, stream_usage: false, stream_usage_editable: true }
const presets = [openai, custom]

const setting = (over: Partial<Setting> = {}): Setting => ({
  revision: 2, margin_bps: 2000, updated_at: '2026-11-06T10:00:00.000Z', updated_by: 'account:7', delivery: 'delivered',
  providers: { oai: { preset: 'openai', provider: 'openai', base_url: null, stream_usage: true, key: { configured: true, last4: '6789' } } },
  models: {
    mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', cached_input_price: null, output_price: '10', usage_reported: true },
    cheap: { provider: 'oai', model: 'gpt-mini', input_price: '0.1', cached_input_price: null, output_price: '0.4', usage_reported: false },
  },
  routes: { default: 'mid', balanced: { quick: 'cheap' } }, ...over,
})

describe('the draft', () => {
  it('shows a saved configuration without any key, margin as a percentage and empty cells as inherit', () => {
    const draft = draftFromSetting(setting())
    expect(draft.margin_percent).toBe('20')
    expect(draft.providers).toEqual([{ id: 'oai', preset: 'openai', base_url: '', api_key: '', stream_usage: true }])
    expect(draft.routes.default).toBe('mid')
    expect(draft.routes.cells['balanced.quick']).toBe('cheap')
    expect(draft.routes.cells['best.writing']).toBe('')
    expect(draftFromSetting(null)).toEqual(emptyConfig())
  })
  it('is dirty after an edit or a typed key, and clean again when restored', () => {
    const draft = draftFromSetting(setting())
    expect(configDirty(draft, setting())).toBe(false)
    draft.margin_percent = '25'
    expect(configDirty(draft, setting())).toBe(true)
    const keyed = draftFromSetting(setting())
    keyed.providers[0]!.api_key = 'sk-12345678'
    expect(configDirty(keyed, setting())).toBe(true)
  })
})

describe('margin', () => {
  it('turns a percentage into basis points and refuses anything else', () => {
    expect(marginBps('20')).toBe(2000)
    expect(marginBps('17.5')).toBe(1750)
    expect(marginBps('0')).toBe(0)
    expect(marginBps('100')).toBe(10_000)
    for (const bad of ['', '100.01', '-1', '1.234', 'abc', '2 0']) expect(marginBps(bad), bad).toBeNull()
  })
  it('shows what a call that costs one dollar is charged', () => {
    expect(chargeForOneDollar(2000)).toBe('1.20')
    expect(chargeForOneDollar(0)).toBe('1.00')
    expect(chargeForOneDollar(1750)).toBe('1.175')
  })
})

describe('which models may serve charged runs', () => {
  it('needs a saved model with both prices and a test that saw token counts', () => {
    const draft = draftFromSetting(setting())
    const [mid, cheap] = [draft.models.find(m => m.id === 'mid')!, draft.models.find(m => m.id === 'cheap')!]
    expect(modelUsable(setting(), mid)).toBe(true)
    expect(modelUsable(setting(), cheap)).toBe(false)
    expect(unusableReason(setting(), cheap)).toBe('untested')
    expect(unusableReason(setting(), { ...mid, output_price: '' })).toBe('unpriced')
    expect(unusableReason(setting(), { ...mid, model: 'gpt-5' })).toBe('unsaved')  // another name was never tested
    expect(unusableReason(setting(), { ...mid, id: 'new' })).toBe('unsaved')
    expect(modelUsable(null, mid)).toBe(false)
  })
})

describe('inheritance', () => {
  it('resolves a cell to its own model, then the balanced one, then the default', () => {
    const { routes } = draftFromSetting(setting())
    expect(effectiveModel(routes, 'balanced', 'quick')).toBe('cheap')
    expect(effectiveModel(routes, 'best', 'quick')).toBe('cheap')
    expect(effectiveModel(routes, 'best', 'analysis')).toBe('mid')
    routes.cells['best.analysis'] = 'big'
    expect(effectiveModel(routes, 'best', 'analysis')).toBe('big')
    expect(effectiveModel({ ...routes, default: '' }, 'economical', 'writing')).toBe('')
  })
  it('warns when balanced quick is not mapped', () => {
    const { routes } = draftFromSetting(setting())
    expect(quickUnmapped(routes)).toBe(false)
    routes.cells['balanced.quick'] = ''
    expect(quickUnmapped(routes)).toBe(true)
  })
})

describe('providers', () => {
  it('knows which models use a provider and picks free ids', () => {
    const draft = draftFromSetting(setting())
    expect(modelsOfProvider(draft, 'oai')).toEqual(['mid', 'cheap'])
    expect(modelsOfProvider(draft, 'other')).toEqual([])
    expect(freeId('openai', ['openai'])).toBe('openai2')
    expect(freeId('custom', [])).toBe('custom')
  })
})

describe('whether a provider is saved', () => {
  const stored = (): Setting => setting({ providers: {
    oai: { preset: 'openai', provider: 'openai', base_url: null, stream_usage: true, key: { configured: true, last4: '6789' } },
    llm: { preset: 'custom', provider: 'openai_compatible', base_url: 'https://llm.example.com/v1', stream_usage: false, key: { configured: true, last4: '1234' } },
  } })
  it('is the same id, preset and endpoint with no key waiting; a catalog endpoint is not compared', () => {
    const [oai, llm] = draftFromSetting(stored()).providers as [ProviderDraft, ProviderDraft]
    expect(providerSaved(stored(), llm, presets)).toBe(true)
    expect(providerSaved(stored(), { ...llm, base_url: 'https://llm.example.com/v1/' }, presets)).toBe(true)
    expect(providerSaved(stored(), { ...llm, base_url: 'https://other.example.com/v1' }, presets)).toBe(false)
    expect(providerSaved(stored(), { ...llm, api_key: 'sk-12345678' }, presets)).toBe(false)
    expect(providerSaved(stored(), { ...oai, preset: 'custom' }, presets)).toBe(false)
    expect(providerSaved(stored(), { ...oai, base_url: 'ignored' }, presets)).toBe(true)
    expect(providerSaved(null, oai, presets)).toBe(false)
  })
  it('asks for the key again once the stored provider has another endpoint', () => {
    const draft = draftFromSetting(stored())
    expect(saveBlockers(draft, stored(), presets)).toEqual([])
    draft.providers[1]!.base_url = 'https://other.example.com/v1'
    expect(saveBlockers(draft, stored(), presets)).toEqual(['providerKey'])
    draft.providers[1]!.api_key = 'sk-12345678'
    expect(saveBlockers(draft, stored(), presets)).toEqual([])
  })
})

describe('isolating values in running text', () => {
  it('wraps a value in left-to-right isolates', () => {
    expect(ltr('mid, cheap')).toBe('\u2066mid, cheap\u2069')
    expect(ltr(3)).toBe('\u20663\u2069')
  })
})

describe('what stops a save', () => {
  const base = () => draftFromSetting(setting())
  it('is nothing for a saved configuration, and names each problem', () => {
    expect(saveBlockers(base(), setting(), presets)).toEqual([])
    expect(saveBlockers(emptyConfig(), null, presets)).toContain('noProviders')
    const bad: ConfigDraft = base()
    bad.providers.push({ id: 'Bad Id', preset: 'custom', base_url: '', api_key: '', stream_usage: false })
    bad.models.push({ id: 'mid', provider: 'ghost', model: '', input_price: '0.000001', cached_input_price: '', output_price: '' })
    bad.margin_percent = 'x'
    expect(saveBlockers(bad, setting(), presets).sort()).toEqual(['margin', 'modelId', 'modelName', 'modelProvider', 'price', 'providerEndpoint', 'providerId', 'providerKey', 'routedPrice'].sort())
  })
  it('needs a key for a new provider but not for a saved one', () => {
    const draft = base()
    draft.providers.push({ id: 'second', preset: 'openai', base_url: '', api_key: '', stream_usage: true })
    expect(saveBlockers(draft, setting(), presets)).toEqual(['providerKey'])
    draft.providers[1]!.api_key = 'sk-12345678'
    expect(saveBlockers(draft, setting(), presets)).toEqual([])
  })
})

describe('prices of a routed model', () => {
  it('keeps a complete pair once it had one, never has half of one, and may change or be zero; the cached-input price is optional', () => {
    const base = () => draftFromSetting(setting())  // mid is routed and priced 2.5 / 10; local is routed and priced 0.1 / 0.2
    const mid = (d: ConfigDraft) => d.models.find(m => m.id === 'mid')!
    expect(saveBlockers(base(), setting(), presets)).toEqual([])
    const cleared = base(); mid(cleared).input_price = ''; mid(cleared).output_price = ''
    expect(saveBlockers(cleared, setting(), presets)).toEqual(['routedPrice'])
    const half = base(); mid(half).output_price = ''
    expect(saveBlockers(half, setting(), presets)).toEqual(['routedPrice'])
    const changed = base(); mid(changed).input_price = '0'; mid(changed).output_price = '99'; mid(changed).cached_input_price = ''
    expect(saveBlockers(changed, setting(), presets)).toEqual([])
    const unrouted = base(); unrouted.routes.default = 'local'; unrouted.routes.cells['balanced.quick'] = ''; mid(unrouted).input_price = ''; mid(unrouted).output_price = ''
    expect(saveBlockers(unrouted, setting(), presets)).toEqual([])  // a model no route uses may lose its price
  })
  it('lets a stored unpriced routed model stay as it is', () => {
    const s = setting(); s.models.mid!.input_price = null; s.models.mid!.output_price = null
    expect(saveBlockers(draftFromSetting(s), s, presets)).toEqual([])
    expect(aiProviderErrorSection({ data: { code: 'model_price_required' } })).toBe('models')
  })
})

describe('the save payload', () => {
  it('passes the contract schema, sends a key only when typed and an endpoint or token option only where the preset takes it', () => {
    const draft = draftFromSetting(setting())
    draft.providers.push({ id: 'llm', preset: 'custom', base_url: ' https://llm.example.com/v1 ', api_key: ' sk-12345678 ', stream_usage: true })
    draft.models.push({ id: 'n', provider: 'llm', model: ' m ', input_price: '', cached_input_price: ' 1.5 ', output_price: '2' })
    draft.routes.cells['best.writing'] = 'mid'
    draft.margin_percent = '17.5'
    const payload = savePayload(draft, presets, '  Switch  ')
    expect(aiProviderSaveSchema.safeParse(payload).success).toBe(true)
    expect(payload.margin_bps).toBe(1750)
    expect(payload.reason).toBe('Switch')
    expect(payload.providers.oai).toEqual({ preset: 'openai' })
    expect(payload.providers.llm).toEqual({ preset: 'custom', base_url: 'https://llm.example.com/v1', api_key: 'sk-12345678', stream_usage: true })
    expect(payload.models.n).toEqual({ provider: 'llm', model: 'm', cached_input_price: '1.5', output_price: '2' })
    expect(payload.routes).toEqual({ default: 'mid', balanced: { quick: 'cheap' }, best: { writing: 'mid' } })
  })
  it('leaves routes out entirely for a draft without any', () => {
    const draft = draftFromSetting(setting({ routes: {} }))
    expect(savePayload(draft, presets, 'Draft').routes).toEqual({})
  })
})

describe('errors', () => {
  const failure = (code: string) => ({ data: { code } })
  it('maps a control plane code to a message and to the part of the page it concerns', () => {
    expect(aiProviderErrorKey(failure('model_not_tested'))).toBe('aiProvider.errors.model_not_tested')
    expect(aiProviderErrorKey(failure('nope'))).toBe('aiProvider.errors.generic')
    expect(aiProviderErrorKey({ statusCode: 503 })).toBe('aiProvider.errors.unavailable')
    expect(aiProviderErrorKey(new StepUpCancelled())).toBe('aiProvider.errors.stepUpCancelled')
    expect(aiProviderErrorSection(failure('unknown_provider'))).toBe('models')
    for (const code of ['unknown_model', 'model_not_priced', 'model_not_tested']) expect(aiProviderErrorSection(failure(code)), code).toBe('routes')
    for (const code of ['api_key_required', 'invalid_base_url', 'invalid_base_url_port']) expect(aiProviderErrorSection(failure(code)), code).toBe('providers')
    expect(aiProviderErrorSection(failure('default_required'))).toBe('routes')
    expect(aiProviderErrorSection(failure('provider_file_unavailable'))).toBe('general')
  })
})
