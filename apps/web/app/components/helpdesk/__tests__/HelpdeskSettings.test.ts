import { readFileSync } from 'node:fs'
import type { HelpdeskSettings, HelpdeskSlaPolicy, HelpdeskStageResource, HelpdeskTeamResource } from '@liwan/contracts'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { buildHelpdeskSettingsPatch } from '../../../utils/helpdeskSettingsPatch'

const policyFile = new URL('../settings/HelpdeskPolicyCard.vue', import.meta.url).pathname
const valueListFile = new URL('../settings/HelpdeskValueListSection.vue', import.meta.url).pathname
const teamsFile = new URL('../settings/HelpdeskTeamsSection.vue', import.meta.url).pathname
const stagesFile = new URL('../settings/HelpdeskStagesSection.vue', import.meta.url).pathname
const slaFile = new URL('../settings/HelpdeskSlaSection.vue', import.meta.url).pathname
const teamFormFile = new URL('../settings/HelpdeskTeamForm.vue', import.meta.url).pathname
const stageFormFile = new URL('../settings/HelpdeskStageForm.vue', import.meta.url).pathname
const slaFormFile = new URL('../settings/HelpdeskSlaForm.vue', import.meta.url).pathname
const settingsPageFile = new URL('../../../pages/settings/apps/helpdesk/index.vue', import.meta.url).pathname

function mountSfc(file: string, bindings: Record<string, unknown>, props: Record<string, unknown>) {
  const script = compileScript(parse(readFileSync(file, 'utf8'), { filename: file }).descriptor, { id: file }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const emitted: Array<[string, unknown]> = []
  const reactiveProps = Vue.reactive(props) as Record<string, unknown>
  const vue = Object.fromEntries(Object.entries(Vue).filter(([name]) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default'))
  const all = {
    ...vue,
    _defineComponent: Vue.defineComponent,
    _unref: Vue.unref,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => Vue.ref(true),
    saveErrorMessage,
    ...bindings,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(all), code)(...Object.values(all))
  const scope = Vue.effectScope()
  const state = Vue.proxyRefs(scope.run(() => component.setup(reactiveProps, { expose: () => {}, emit: (name: string, value?: unknown) => emitted.push([name, value]) })))
  return { state, emitted, stop: () => scope.stop() }
}

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

  it('renders HelpdeskValueListSection on SharedSettingsList and SharedSettingsListRow with a reset key', () => {
    const source = readFileSync(valueListFile, 'utf8')
    expect(source).toContain('<SharedSettingsList')
    expect(source).toContain('<SharedSettingsListRow')
    expect(source).toContain(':key="`${row.id}-${resetGeneration}`"')
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

  it('gates useHelpdeskSettings on helpdesk.settings.read and derives active policy options from resources without useHelpdeskReference', () => {
    const source = readFileSync(settingsPageFile, 'utf8')
    expect(source).not.toContain('useHelpdeskReference')

    let readable = false
    const settingsEnabled: Array<() => boolean> = []
    const stages: HelpdeskStageResource[] = [
      { id: 1, name: 'جديدة', sequence: 10, active: true, closed: false, unattended: false, fold: false, shared: false, team_ids: [] },
      { id: 2, name: 'مؤرشفة', sequence: 20, active: false, closed: false, unattended: false, fold: false, shared: false, team_ids: [] },
    ]
    const teams: HelpdeskTeamResource[] = [
      { id: 5, name: 'الدعم', sequence: 10, active: true, leader_id: null, calendar_id: null, member_ids: [] },
      { id: 6, name: 'فريق قديم', sequence: 20, active: false, leader_id: null, calendar_id: null, member_ids: [] },
    ]
    const stub = {}
    const { state, stop } = mountSfc(settingsPageFile, {
      HelpdeskPolicyCard: stub,
      HelpdeskSlaSection: stub,
      HelpdeskStagesSection: stub,
      HelpdeskTeamsSection: stub,
      HelpdeskValueListSection: stub,
      useSettingsPage: () => ({ parts: Vue.ref([]) }),
      useAccess: () => ({ can: (cap: string) => cap === 'helpdesk.settings.read' && readable }),
      useHelpdeskSettings: (enabled?: () => boolean) => {
        if (enabled) settingsEnabled.push(enabled)
        return { data: Vue.ref(null), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }
      },
      useHelpdeskResources: () => ({
        data: Vue.ref({ stages, teams, categories: [], tags: [], channels: [], types: [] }),
        isLoading: Vue.ref(false),
        error: Vue.ref(null),
      }),
      useHelpdeskSla: () => ({ data: Vue.ref(null), isLoading: Vue.ref(false), error: Vue.ref(null) }),
    }, {})

    try {
      expect(settingsEnabled).toHaveLength(1)
      expect(settingsEnabled[0]!()).toBe(false)
      readable = true
      expect(settingsEnabled[0]!()).toBe(true)
      expect(state.activeStages).toEqual([stages[0]])
      expect(state.activeTeams).toEqual([teams[0]])
    } finally {
      stop()
    }
  })

  it('increments resetGeneration in HelpdeskValueListSection when an inline rename fails', async () => {
    const mutateAsync = vi.fn().mockRejectedValueOnce(new ApiError(422, 'invalid', 'duplicate')).mockResolvedValueOnce({ id: 1, name: 'جديد', active: true, sequence: 10 })
    const row = { id: 1, name: 'قديم', active: true, sequence: 10 }
    const { state, stop } = mountSfc(valueListFile, {
      useSaveHelpdeskResource: () => ({ mutateAsync, isPending: Vue.ref(false) }),
    }, { kind: 'tags', rows: [row], canEdit: true })

    try {
      expect(state.resetGeneration).toBe(0)
      await state.renameRow(row, 'مكرر')
      expect(state.resetGeneration).toBe(1)
      expect(state.failure).toBe('duplicate')

      await state.renameRow(row, 'جديد')
      expect(state.resetGeneration).toBe(1)
      expect(state.failure).toBeNull()
    } finally {
      stop()
    }
  })

  it('includes active closed stages and an archived policy stage in HelpdeskSlaForm stageItems', () => {
    const stages: HelpdeskStageResource[] = [
      { id: 1, name: 'جديدة', sequence: 10, active: true, closed: false, unattended: false, fold: false, shared: false, team_ids: [] },
      { id: 2, name: 'تم الحل', sequence: 20, active: true, closed: true, unattended: false, fold: false, shared: false, team_ids: [] },
      { id: 3, name: 'مرحلة مؤرشفة', sequence: 30, active: false, closed: false, unattended: false, fold: false, shared: false, team_ids: [] },
    ]
    const policy: HelpdeskSlaPolicy = {
      id: 9,
      name: 'اتفاقية قديمة',
      active: true,
      days: 1,
      hours: 2,
      stage_id: 3,
      team_ids: [],
      category_ids: [],
      tag_ids: [],
      ignore_stage_ids: [],
      ticket_count: 0,
    }
    const bindings = { useSaveHelpdeskSla: () => ({ mutateAsync: vi.fn(), isPending: Vue.ref(false) }) }
    const createMount = mountSfc(slaFormFile, bindings, { stages, teams: [], categories: [], tags: [] })
    const editMount = mountSfc(slaFormFile, bindings, { policy, stages, teams: [], categories: [], tags: [] })

    try {
      expect(createMount.state.stageItems).toEqual([
        { value: 1, label: 'جديدة' },
        { value: 2, label: 'تم الحل' },
      ])
      expect(createMount.state.stageId).toBe(1)

      expect(editMount.state.stageItems).toEqual([
        { value: 1, label: 'جديدة' },
        { value: 2, label: 'تم الحل' },
        { value: 3, label: 'مرحلة مؤرشفة' },
      ])
      expect(editMount.state.stageId).toBe(3)
    } finally {
      createMount.stop()
      editMount.stop()
    }
  })

  it('keeps submit enabled before first validation attempt and validates on submit in Helpdesk forms', async () => {
    for (const file of [teamFormFile, stageFormFile, slaFormFile]) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain(':disabled="disabled || !valid"')
      expect(source, file).toContain('attempted')
    }

    const saveResource = vi.fn().mockResolvedValue({ id: 1, name: 'الفريق' })
    const teamMount = mountSfc(teamFormFile, {
      useSaveHelpdeskResource: () => ({ mutateAsync: saveResource, isPending: Vue.ref(false) }),
    }, {})
    const stageMount = mountSfc(stageFormFile, {
      useSaveHelpdeskResource: () => ({ mutateAsync: saveResource, isPending: Vue.ref(false) }),
    }, { teams: [] })
    const saveSla = vi.fn().mockResolvedValue({ id: 1, name: 'SLA' })
    const slaMount = mountSfc(slaFormFile, {
      useSaveHelpdeskSla: () => ({ mutateAsync: saveSla, isPending: Vue.ref(false) }),
    }, { stages: [], teams: [], categories: [], tags: [] })

    try {
      expect(teamMount.state.attempted).toBe(false)
      await teamMount.state.submit()
      expect(teamMount.state.attempted).toBe(true)
      expect(teamMount.state.nameError).toBe('helpdesk.settings.resources.nameRequired')
      expect(saveResource).not.toHaveBeenCalled()

      teamMount.state.name = 'الدعم'
      await teamMount.state.submit()
      expect(saveResource).toHaveBeenCalledTimes(1)
      expect(teamMount.emitted).toContainEqual(['done', undefined])

      expect(stageMount.state.attempted).toBe(false)
      await stageMount.state.submit()
      expect(stageMount.state.attempted).toBe(true)
      expect(stageMount.state.nameError).toBe('helpdesk.settings.resources.nameRequired')
      expect(saveResource).toHaveBeenCalledTimes(1)

      expect(slaMount.state.attempted).toBe(false)
      await slaMount.state.submit()
      expect(slaMount.state.attempted).toBe(true)
      expect(slaMount.state.nameError).toBe('helpdesk.settings.resources.nameRequired')
      expect(slaMount.state.stageError).toBe('helpdesk.settings.sla.targetRequired')
      expect(saveSla).not.toHaveBeenCalled()
    } finally {
      teamMount.stop()
      stageMount.stop()
      slaMount.stop()
    }
  })
})
