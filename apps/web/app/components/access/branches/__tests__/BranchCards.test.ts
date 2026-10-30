import { resolve } from 'node:path'
import * as Vue from 'vue'
import { BRANCH_PRESETS } from '@liwan/contracts'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, findNode, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'
import { useSettingsForm } from '../../../../composables/settings/useSettingsForm'

const roles = [
  { id: 1, key: 'employee', name: { ar: 'موظف', en: 'Employee' }, company_id: null, active: true },
  { id: 2, key: 'hr_manager', name: { ar: 'مدير الموارد البشرية', en: 'HR manager' }, company_id: null, active: true },
  { id: 3, key: 'old_role', name: { ar: 'قديم', en: 'Old' }, company_id: null, active: false },
]
const policy = (preset: string, branches: unknown[] = [{ id: 7, name: 'الرياض', inherit: false, role_ids: [] }]) => ({
  version: 'b1-v2', mode: 'delegated', preset, strict_scopes: [], branches, roles,
})

// The real card draws the footer; the stub shows what the form hands it and lets a test press «Save».
const card = Vue.defineComponent({
  inheritAttrs: false,
  props: ['id', 'dirty', 'canEdit', 'title', 'description', 'saveLabel'],
  emits: ['save'],
  setup(props, { emit, slots }) {
    return () => Vue.h('section', { 'data-card': props.id, 'data-dirty': props.dirty, 'data-can-edit': props.canEdit, 'data-save-label': props.saveLabel }, [
      Vue.h('button', { 'data-save': props.id, onClick: () => emit('save') }), slots.default?.(),
    ])
  },
})
const radio = Vue.defineComponent({
  props: ['modelValue', 'items'], emits: ['update:modelValue'],
  setup: (props, { emit }) => () => Vue.h('div', { 'data-selected': props.modelValue }, props.items.map((item: { value: string; description: string; disabled: boolean }) =>
    Vue.h('button', { 'data-item': item.value, 'data-disabled': item.disabled, onClick: () => emit('update:modelValue', item.value) }, item.description))),
})
const passthrough = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('div', attrs, slots.default?.()) } })
const alertStub = Vue.defineComponent({ props: ['title'], setup: props => () => Vue.h('aside', props.title) })
const switchStub = Vue.defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (props, { emit }) => () => Vue.h('button', { 'data-switch': props.modelValue, onClick: () => emit('update:modelValue', !props.modelValue) }) })
const stubs = { ...DEFAULT_STUBS, SharedSettingsCard: card, URadioGroup: radio, UAlert: alertStub, UFormField: passthrough, USwitch: switchStub }
const textOf = (node: HostNode): string => (node.type === 'comment' ? '' : node.text ?? '') + node.children.map(textOf).join('')
const settle = async () => { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }
const t = (key: string, params?: Record<string, string>) => params ? `${key}|${params.roles}` : key
const common = { useI18n: () => ({ t, locale: Vue.ref('ar') }), useHydrated: () => Vue.ref(true) }
vi.stubGlobal('useI18n', common.useI18n)

function mountPreset(value: ReturnType<typeof policy>, mutateAsync = vi.fn(async () => policy('central_branches'))) {
  const component = loadShared(resolve(import.meta.dirname, '../BranchPresetCard.vue'), {
    globals: common,
    modules: {
      '@liwan/contracts': { BRANCH_PRESETS },
      '@/composables/settings/useSettingsForm': { useSettingsForm },
      '@/composables/useBranchAccess': { useApplyBranchPreset: () => ({ mutateAsync, isPending: Vue.ref(false) }) },
    },
  })
  const app = hostRenderer.createApp({ render: () => Vue.h(component, { policy: value, reloadPolicy: async () => value }) })
  for (const [name, stub] of Object.entries(stubs)) app.component(name, stub)
  const root = createHostNode(); app.mount(root)
  return { app, root, mutateAsync, item: (key: string) => findNode(root, n => n.props['data-item'] === key)! }
}

describe('branch preset card', () => {
  it('offers the four presets, names the inherited roles and blocks single company while branches exist', () => {
    const view = mountPreset(policy('independent_branches'))
    for (const key of BRANCH_PRESETS) expect(view.item(key)).toBeTruthy()
    expect(textOf(view.item('central_branches'))).toBe('access.branches.presets.central_branchesHint|مدير الموارد البشرية')
    expect(view.item('single_company').props['data-disabled']).toBe(true)
    expect(view.item('group_of_companies').props['data-disabled']).toBe(false)
    view.app.unmount()
  })
  it('allows single company without branches and says so when the setup is custom', () => {
    const view = mountPreset(policy('custom', []))
    expect(view.item('single_company').props['data-disabled']).toBe(false)
    expect(textOf(view.root)).toContain('access.branches.presets.custom')
    view.app.unmount()
  })
  it('sends only the preset and the policy version when saved', async () => {
    const view = mountPreset(policy('independent_branches'))
    ;(view.item('central_branches').props.onClick as () => void)(); await settle()
    expect(textOf(view.root)).toContain('access.branches.presets.confirm')
    await (findNode(view.root, n => n.props['data-save'] === 'branch-preset')!.props.onClick as () => Promise<void>)(); await settle()
    expect(view.mutateAsync).toHaveBeenCalledWith({ expected_version: 'b1-v2', preset: 'central_branches' })
    view.app.unmount()
  })
})

function mountStrict(initial: { scope: string; enabled: boolean } | undefined, canEdit = true) {
  const me = Vue.ref<{ id: number; company: { id: number } } | null>({ id: 1, company: { id: 10 } })
  const mutateAsync = vi.fn(async (body: { enabled: boolean }) => ({ scope: 'payroll', enabled: body.enabled }))
  const data = Vue.ref(initial)
  const strictModules = {
    '@/composables/settings/useSettingsForm': { useSettingsForm },
    '@/composables/useBranchStrictness': {
      useBranchStrictness: () => ({ data, refetch: async () => ({ data: data.value, isError: false }) }),
      useUpdateBranchStrictness: () => ({ mutateAsync }),
    },
  }
  const form = loadShared(resolve(import.meta.dirname, '../BranchStrictForm.vue'), { globals: common, modules: strictModules })
  const component = loadShared(resolve(import.meta.dirname, '../BranchStrictCard.vue'), {
    globals: { ...common, useMe: () => ({ me }) },
    modules: { ...strictModules, '@/components/access/branches/BranchStrictForm.vue': { __esModule: true, default: form } },
  })
  const app = hostRenderer.createApp({ render: () => Vue.h(component, { scope: 'payroll', path: '/api/v1/hr/payroll/branch-strictness', canRead: true, canEdit }) })
  for (const [name, stub] of Object.entries(stubs)) app.component(name, stub)
  const root = createHostNode(); app.mount(root)
  return { app, root, mutateAsync, me, data, switchNode: () => findNode(root, n => n.props['data-switch'] !== undefined)! }
}

describe('branch strict card', () => {
  it('stays hidden until the setting is readable', () => {
    const view = mountStrict(undefined)
    expect(findNode(view.root, n => n.props['data-card'] !== undefined)).toBeUndefined()
    view.app.unmount()
  })
  it('turns the switch on with one PATCH of enabled only, and warns when turning it off', async () => {
    const view = mountStrict({ scope: 'payroll', enabled: false })
    expect(view.switchNode().props['data-switch']).toBe(false)
    ;(view.switchNode().props.onClick as () => void)(); await settle()
    await (findNode(view.root, n => n.props['data-save'] === 'branch-strict-payroll')!.props.onClick as () => Promise<void>)(); await settle()
    expect(view.mutateAsync).toHaveBeenCalledWith({ enabled: true })
    expect(view.switchNode().props['data-switch']).toBe(true)
    ;(view.switchNode().props.onClick as () => void)(); await settle()
    expect(textOf(view.root)).toContain('access.branches.strict.widens')
    view.app.unmount()
  })
  it('drops an unsaved edit when the company changes, so it never saves into another company', async () => {
    const view = mountStrict({ scope: 'payroll', enabled: false })
    ;(view.switchNode().props.onClick as () => void)(); await settle()
    expect(view.switchNode().props['data-switch']).toBe(true)
    view.me.value = { id: 1, company: { id: 11 } }; await settle()
    expect(view.switchNode().props['data-switch']).toBe(false)
    view.app.unmount()
  })
  it('passes the edit right to the card', () => {
    const view = mountStrict({ scope: 'payroll', enabled: true }, false)
    expect(findNode(view.root, n => n.props['data-card'] === 'branch-strict-payroll')!.props['data-can-edit']).toBe(false)
    view.app.unmount()
  })
})
