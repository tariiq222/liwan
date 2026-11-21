import { readFileSync } from 'node:fs'
import { InboxCampaignSettingsPatchSchema, InboxConsentPolicySchema, InboxSettingsPatchSchema, type InboxCampaignSettings, type InboxSettings } from '@liwan/contracts'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'

const policyFile = new URL('../InboxPolicyCard.vue', import.meta.url).pathname
const campaignFile = new URL('../campaigns/InboxCampaignSettingsCard.vue', import.meta.url).pathname

const policy = (overrides: Partial<InboxSettings> = {}): InboxSettings => ({
  visibility_policy: 'department', auto_close_hours: 72, retention_months: 24, assignment_policy: 'manual', first_response_alert_minutes: 0,
  report_retention_months: 36, agent_shifts_enabled: false, unavailable_release: 'keep', ...overrides,
})
const campaigns = (overrides: Partial<InboxCampaignSettings> = {}): InboxCampaignSettings => ({
  consent_policy: 'opted_in_only', default_country_code: null, keyword_opt_out: true, stop_keywords: ['stop'], start_keywords: [],
  stop_reply: null, start_reply: null, default_daily_cap: 0, ...overrides,
})

type CardProps<Settings> = { settings: Settings; canEdit?: boolean; reloadSettings?: () => Promise<Settings> }

// The component script is compiled and run against stubbed composables, as the other card tests do.
function mountCard<Settings>(filename: string, props: CardProps<Settings>, bindings: Record<string, unknown>) {
  const automationOn = bindings.automationOn ?? true
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-settings-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutateAsync = vi.fn()
  const all = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ApiError, useSettingsForm,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useUpdateInboxSettings: () => ({ mutateAsync }), useUpdateInboxCampaignSettings: () => ({ mutateAsync }),
    useInboxAutomationEnabled: () => Vue.ref(automationOn),
    InboxSettingsPatchSchema, InboxCampaignSettingsPatchSchema, InboxConsentPolicySchema, ...bindings,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(all), code)(...Object.values(all))
  const card = component.setup(Vue.reactive({ canEdit: true, reloadSettings: vi.fn(), ...props }), { expose: () => {}, emit: () => {} })
  return { card, mutateAsync }
}
const mountPolicy = (props: CardProps<InboxSettings>, automationOn = true) => mountCard(policyFile, props, { automationOn })
const mountCampaigns = (props: CardProps<InboxCampaignSettings>) => mountCard(campaignFile, props, {})

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('the inbox settings cards', () => {
  it('are shared settings cards that keep their anchors and own no button or toast', () => {
    for (const [file, id] of [[policyFile, 'policy'], [campaignFile, 'campaigns']] as const) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toContain(`<SharedSettingsCard id="${id}"`)
      for (const old of ['<UButton', 'useToast', '<SharedFormSection', '<form', 'SharedUnsavedChanges']) expect(source, `${file} ${old}`).not.toContain(old)
    }
  })
})

describe('InboxPolicyCard', () => {
  it('saves the whole policy through its save and adopts the answer', async () => {
    const { card, mutateAsync } = mountPolicy({ settings: policy() })
    mutateAsync.mockResolvedValue(policy({ visibility_policy: 'all' }))
    card.draft.value.visibility_policy = 'all'
    expect(card.state.value.dirty).toBe(true)
    await card.save()
    expect(mutateAsync).toHaveBeenCalledWith(policy({ visibility_policy: 'all' }))
    expect(card.state.value.dirty).toBe(false)
  })

  it('saves nothing while unchanged and reverts an edit', async () => {
    const { card, mutateAsync } = mountPolicy({ settings: policy() })
    await card.save()
    expect(mutateAsync).not.toHaveBeenCalled()
    card.draft.value.auto_close_hours = 5
    card.revert()
    expect(card.draft.value.auto_close_hours).toBe(72)
  })

  it('refuses a value the contract rejects, inside the card', async () => {
    const { card, mutateAsync } = mountPolicy({ settings: policy() })
    card.draft.value.auto_close_hours = 9999
    await card.save()
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(card.state.value.message).toBe('errors.generic')
  })

  it('locks on a 409 until the current values are reloaded', async () => {
    const reloadSettings = vi.fn(async () => policy({ retention_months: 60 }))
    const { card, mutateAsync } = mountPolicy({ settings: policy(), reloadSettings })
    mutateAsync.mockRejectedValue(new ApiError(409, 'conflict', 'stale'))
    card.draft.value.auto_close_hours = 5
    await card.save()
    expect(card.state.value.conflict).toBe(true)
    await card.reload()
    expect(card.state.value.conflict).toBe(false)
    expect(card.draft.value.retention_months).toBe(60)
  })

  it('locks the assignment policy and the first-response alert, with the reason, when the tenant has no automation', () => {
    const { card } = mountPolicy({ settings: policy() }, false)
    expect(card.locked.value).toBe(false)
    expect(card.automationLocked.value).toBe(true)
    expect(card.automationReason.value).toBe('inbox.settings.policy.automationLocked')
    const source = readFileSync(policyFile, 'utf8')
    expect(source).toContain(':disabled="automationLocked"')
    expect(source.match(/:disabled="locked"/g)?.length).toBeGreaterThan(3)
  })

  it('leaves those two fields editable with automation on', () => {
    const { card } = mountPolicy({ settings: policy() })
    expect(card.automationLocked.value).toBe(false)
    expect(card.automationReason.value).toBeUndefined()
  })

  it('disables every field for a viewer', () => {
    const { card } = mountPolicy({ settings: policy(), canEdit: false })
    expect(card.locked.value).toBe(true)
  })
})

describe('InboxCampaignSettingsCard', () => {
  it('writes the draft back as the settings shape', async () => {
    const { card, mutateAsync } = mountCampaigns({ settings: campaigns() })
    mutateAsync.mockResolvedValue(campaigns({ default_country_code: '966', stop_reply: 'Done' }))
    card.draft.value.countryCode = ' 966 '
    card.draft.value.stopReplyOn = true
    card.draft.value.stopReply = ' Done '
    await card.save()
    expect(mutateAsync).toHaveBeenCalledWith(campaigns({ default_country_code: '966', stop_reply: 'Done' }))
    expect(card.state.value.dirty).toBe(false)
  })

  it('refuses an invalid country code inside the card', async () => {
    const { card, mutateAsync } = mountCampaigns({ settings: campaigns() })
    card.draft.value.countryCode = '0'
    await card.save()
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(card.state.value.message).toBe('errors.generic')
  })

  it('shows the server refusal inside the card and keeps the draft', async () => {
    const { card, mutateAsync } = mountCampaigns({ settings: campaigns() })
    mutateAsync.mockRejectedValue(new ApiError(422, 'invalid', 'country code refused'))
    card.draft.value.dailyCap = 50
    await card.save()
    expect(card.state.value.message).toBe('country code refused')
    expect(card.draft.value.dailyCap).toBe(50)
  })
})
