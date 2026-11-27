import { readFileSync } from 'node:fs'
import type { HelpdeskSettings } from '@liwan/contracts'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'
import { buildHelpdeskSettingsPatch } from '../../../utils/helpdeskSettingsPatch'

const policyFile = new URL('../settings/HelpdeskPolicyCard.vue', import.meta.url).pathname
const valueListFile = new URL('../settings/HelpdeskValueListSection.vue', import.meta.url).pathname
const teamsFile = new URL('../settings/HelpdeskTeamsSection.vue', import.meta.url).pathname
const stagesFile = new URL('../settings/HelpdeskStagesSection.vue', import.meta.url).pathname
const slaFile = new URL('../settings/HelpdeskSlaSection.vue', import.meta.url).pathname

const settingsFixture = (overrides: Partial<HelpdeskSettings> = {}): HelpdeskSettings => ({
  revision: 3,
  preset: 'general',
  visibility: 'team',
  default_team_id: 1,
  default_priority: '1',
  reference_prefix: 'HD',
  reopen_days: 7,
  first_response_hours: 8,
  resolution_hours: 72,
  portal_enabled: true,
  auto_close_days: 0,
  auto_close_stage_ids: [],
  options: {
    presets: [{ value: 'general', label: 'General' }, { value: 'it', label: 'IT' }],
    visibility: [{ value: 'own', label: 'Own' }, { value: 'team', label: 'Team' }, { value: 'all', label: 'All' }],
    priorities: [{ value: '0', label: 'Low' }, { value: '1', label: 'Medium' }, { value: '2', label: 'High' }, { value: '3', label: 'Urgent' }],
    priority_names: { '0': 'low', '1': 'medium', '2': 'high', '3': 'urgent' },
    ranges: {},
  },
  ...overrides,
})

function mountPolicy(props: { settings: HelpdeskSettings; canEdit?: boolean; reloadSettings?: () => Promise<HelpdeskSettings>; hydrated?: boolean }) {
  const script = compileScript(parse(readFileSync(policyFile, 'utf8'), { filename: policyFile }).descriptor, { id: 'helpdesk-policy-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutateAsync = vi.fn()
  const all = {
    _defineComponent: Vue.defineComponent,
    computed: Vue.computed,
    useSettingsForm,
    buildHelpdeskSettingsPatch,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => Vue.ref(props.hydrated ?? true),
    useSaveHelpdeskSettings: () => ({ mutateAsync }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(all), code)(...Object.values(all))
  const card = component.setup(Vue.reactive({
    stages: [{ id: 11, name: 'New' }],
    teams: [{ id: 1, name: 'Support' }],
    canEdit: true,
    reloadSettings: vi.fn(),
    ...props,
  }), { expose: () => {}, emit: () => {} })
  return { card, mutateAsync }
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('HelpdeskPolicyCard', () => {
  it('saves edited fields cleanly with no success message in the error slot', async () => {
    const { card, mutateAsync } = mountPolicy({ settings: settingsFixture() })
    mutateAsync.mockResolvedValue(settingsFixture({ revision: 4, reference_prefix: 'SUP' }))
    card.draft.value.reference_prefix = 'SUP'
    expect(card.state.value.dirty).toBe(true)
    await card.save()
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ revision: 3, reference_prefix: 'SUP', preset: 'general' }))
    expect(card.state.value.dirty).toBe(false)
    expect(card.state.value.message).toBe('')
  })

  it('drops preset bundle fields when switching preset so the server applies the new preset', async () => {
    const { card, mutateAsync } = mountPolicy({ settings: settingsFixture() })
    mutateAsync.mockResolvedValue(settingsFixture({ revision: 4, preset: 'it', first_response_hours: 2 }))
    card.draft.value.preset = 'it'
    await card.save()
    const sent = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>
    expect(sent).toMatchObject({ revision: 3, preset: 'it' })
    for (const key of ['visibility', 'default_priority', 'reopen_days', 'first_response_hours', 'resolution_hours']) {
      expect(sent).not.toHaveProperty(key)
    }
    expect(card.draft.value.first_response_hours).toBe(2)
  })

  it('locks on a 409 conflict and unlocks after reloading current settings', async () => {
    const reloadSettings = vi.fn(async () => settingsFixture({ revision: 5, reference_prefix: 'NEW' }))
    const { card, mutateAsync } = mountPolicy({ settings: settingsFixture(), reloadSettings })
    mutateAsync.mockRejectedValue(new ApiError(409, 'conflict', 'stale'))
    card.draft.value.reference_prefix = 'OLD'
    await card.save()
    expect(card.state.value.conflict).toBe(true)
    expect(card.locked.value).toBe(true)
    await card.reload()
    expect(reloadSettings).toHaveBeenCalledOnce()
    expect(card.state.value.conflict).toBe(false)
    expect(card.locked.value).toBe(false)
    expect(card.draft.value.reference_prefix).toBe('NEW')
  })

  it('locks every control for a read-only viewer and before hydration', () => {
    expect(mountPolicy({ settings: settingsFixture(), canEdit: false }).card.locked.value).toBe(true)
    expect(mountPolicy({ settings: settingsFixture(), hydrated: false }).card.locked.value).toBe(true)
  })
})

describe('Helpdesk settings sections structure', () => {
  it('uses SharedSettingsCard on HelpdeskPolicyCard and disables auto-close stages when locked', () => {
    const source = readFileSync(policyFile, 'utf8')
    expect(source).toContain('<SharedSettingsCard')
    expect(source).toContain('v-bind="state"')
    expect(source).toContain('liwan-auto-grid liwan-field-grid liwan-setting-fields')
    expect(source).toContain('<SharedSettingRow')
    expect(source).toMatch(/data-testid="helpdesk-settings-auto-close-stages"[\s\S]*?:disabled="locked"|:disabled="locked"[\s\S]*?data-testid="helpdesk-settings-auto-close-stages"/)
  })

  it('renders HelpdeskValueListSection on SharedSettingsList and SharedSettingsListRow', () => {
    const source = readFileSync(valueListFile, 'utf8')
    expect(source).toContain('<SharedSettingsList')
    expect(source).toContain('<SharedSettingsListRow')
    expect(source).not.toContain('<form')
  })

  it('moves teams, stages and SLA creation/editing out of inline forms onto routes', () => {
    for (const [file, basePath] of [
      [teamsFile, '/settings/apps/helpdesk/teams'],
      [stagesFile, '/settings/apps/helpdesk/stages'],
      [slaFile, '/settings/apps/helpdesk/sla'],
    ] as const) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain('<form')
      expect(source, file).toContain(`${basePath}/new`)
      expect(source, file).toContain(`${basePath}/\${`)
      expect(source, file).toContain('/edit')
      expect(source, file).toContain('<UAlert')
    }
  })
})
