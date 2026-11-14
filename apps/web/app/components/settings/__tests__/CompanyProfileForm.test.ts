import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyProfile } from '@liwan/contracts'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { companyPatch, profileToForm, SECTION_FIELDS, sectionExtensions, vatNumberMissing } from '../../../utils/companyProfile'

const PROFILE = {
  id: 1, name: 'ليوان', logo_url: null, report_header: null, company_registry: '1010',
  vat_registered: false, vat_registration_editable: true, is_root_company: true, vat: null,
  address: { street: null, street2: null, city: null, zip: null, state: null, country: { id: 1, name: 'السعودية' } },
  email: null, phone: null, website: null, extensions: [], completeness: { done: 1, total: 2 },
} as unknown as CompanyProfile

const filename = new URL('../CompanyProfileForm.vue', import.meta.url).pathname
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText

// The card's script, compiled and run with the settings-form composable stubbed to hand back its options, so the save
// step runs exactly as the card wires it.
function run(capabilities: string[], profile: CompanyProfile = PROFILE, taxOwnsVat = false) {
  const script = compileScript(descriptor, { id: 'CompanyProfileForm' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutateAsync = vi.fn(async (patch: object) => ({ ...profile, ...patch }))
  let options: { save: (draft: Record<string, unknown>, latest: CompanyProfile) => Promise<CompanyProfile> } | undefined
  const draft = Vue.ref<Record<string, unknown>>({})
  const base = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, ApiError, CompanyExtensionField: {}, companyPatch, profileToForm, SECTION_FIELDS, sectionExtensions, vatNumberMissing,
    useI18n: () => ({ t: (key: string) => key }), useToast: () => ({ add: vi.fn() }), useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: (capability: string) => capabilities.includes(capability) }),
    useCompanyProfile: () => ({ refetch: vi.fn() }), useUpdateCompany: () => ({ mutateAsync }), useUploadCompanyLogo: () => ({ isPending: Vue.ref(false), mutateAsync: vi.fn() }),
    useCompanyStates: () => ({ data: Vue.ref(undefined) }), saveErrorMessage: (e: Error) => e.message,
    // The card's own `read`, so the draft is exactly what it owns on this page.
    useSettingsForm: (given: typeof options & { read: (source: CompanyProfile) => Record<string, unknown> }) => { options = given; draft.value = given.read(profile); return { draft, state: Vue.ref({ saving: false, reloading: false }), save: vi.fn(), revert: vi.fn(), reload: vi.fn() } },
  }
  const component = new Function(...Object.keys(base), transpile(script))(...Object.values(base))
  const scope = Vue.effectScope()
  const state = Vue.proxyRefs(scope.run(() => component.setup({ profile, section: 'profile', taxOwnsVat }, { expose: () => {}, emit: () => {} })))
  return { state, mutateAsync, save: (values: Record<string, unknown>) => options!.save({ ...profileToForm(profile), ...values }, profile), stop: () => scope.stop() }
}

// The card with the real settings-form composable, over reactive props, so a test changes `taxOwnsVat` after mount the way
// the tax query resolving after the profile query does.
function runWithRealForm(profile: CompanyProfile, taxOwnsVat: boolean, capabilities = ['settings.company.manage', 'settings.company.vat.manage']) {
  const script = compileScript(descriptor, { id: 'CompanyProfileForm' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const base = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, ApiError, CompanyExtensionField: {}, companyPatch, profileToForm, SECTION_FIELDS, sectionExtensions, vatNumberMissing,
    useI18n: () => ({ t: (key: string) => key }), useToast: () => ({ add: vi.fn() }), useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: (capability: string) => capabilities.includes(capability) }),
    useCompanyProfile: () => ({ refetch: vi.fn() }), useUpdateCompany: () => ({ mutateAsync: vi.fn(async (patch: object) => ({ ...profile, ...patch })) }), useUploadCompanyLogo: () => ({ isPending: Vue.ref(false), mutateAsync: vi.fn() }),
    useCompanyStates: () => ({ data: Vue.ref(undefined) }), saveErrorMessage, useSettingsForm,
  }
  const component = new Function(...Object.keys(base), transpile(script))(...Object.values(base))
  const props = Vue.reactive({ profile, section: 'profile', taxOwnsVat })
  const scope = Vue.effectScope()
  const state = Vue.proxyRefs(scope.run(() => component.setup(props, { expose: () => {}, emit: () => {} })))
  return { props, state, stop: () => scope.stop() }
}

// The card's template with named stubs that record their props, so a test reads the form's controls as rendered.
async function renderControls(capabilities: string[], profile: CompanyProfile = PROFILE, taxOwnsVat = false) {
  const card = run(capabilities, profile, taxOwnsVat)
  const props = { profile, section: 'profile', taxOwnsVat }
  const compiled = compileTemplate({
    source: descriptor.template!.content, filename, id: 'CompanyProfileForm', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const render = new Function('Vue', transpile(compiled.code))(Vue) as (props: Record<string, unknown>, cache: number) => unknown
  const captured: { name: string, props: Record<string, unknown> }[] = []
  const app = Vue.createSSRApp(Vue.defineComponent({
    setup: () => ({ ...props, ...Object.fromEntries(Object.entries(card.state).filter(([key]) => !key.startsWith('$'))) }),
    render: render as never,
  }))
  for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
    app.component(name, Vue.defineComponent({
      inheritAttrs: false,
      setup(_, { attrs, slots }) {
        return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', slots.default?.()) }
      },
    }))
  }
  await renderToString(app)
  card.stop()
  return captured
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('CompanyProfileForm: who may change the VAT status', () => {
  it('follows the server: a root session with the VAT right gets the editable switch', () => {
    const { state } = run(['settings.company.manage', 'settings.company.vat.manage'])
    expect(state.editable).toBe(true)
    expect(state.locked).toBe(false)
    expect(state.vatEditable).toBe(true)
    expect(state.vatLocked).toBe(false)
  })

  it('locks the switch in a branch session even for the VAT-right holder, naming the main company', () => {
    const { state } = run(['settings.company.manage', 'settings.company.vat.manage'], { ...PROFILE, vat_registration_editable: false, is_root_company: false } as CompanyProfile)
    expect(state.vatEditable).toBe(false)
    expect(state.vatLocked).toBe(true)
    expect(state.vatReason).toBe('settings.company.tax.changedFromRoot')
  })

  it('takes the switch from the server answer, not from the capability alone', () => {
    expect(run(['settings.company.manage'], { ...PROFILE, vat_registration_editable: true } as CompanyProfile).state.vatLocked).toBe(false)
    expect(run(['settings.company.manage', 'settings.company.vat.manage'], { ...PROFILE, vat_registration_editable: false } as CompanyProfile).state.vatLocked).toBe(true)
  })

  it('locks the switch for a company editor without the VAT right, naming the missing permission', () => {
    const { state } = run(['settings.company.manage'], { ...PROFILE, vat_registration_editable: false } as CompanyProfile)
    expect(state.vatEditable).toBe(false)
    expect(state.vatLocked).toBe(true)
    expect(state.vatReason).toBe('settings.company.vatManageHint')
  })

  it('gives a root session that holds the VAT right but is read-only no reason that blames the permission or the branch', () => {
    const { state } = run(['settings.company.manage', 'settings.company.vat.manage'], { ...PROFILE, vat_registration_editable: false } as CompanyProfile)
    expect(state.vatLocked).toBe(true)
    expect(state.vatReason).toBeUndefined()
  })

  it('names the main company for a branch session whatever rights it holds', () => {
    const branch = { ...PROFILE, vat_registration_editable: false, is_root_company: false } as CompanyProfile
    expect(run(['settings.company.manage'], branch).state.vatReason).toBe('settings.company.tax.changedFromRoot')
    expect(run(['settings.company.manage', 'settings.company.vat.manage'], branch).state.vatReason).toBe('settings.company.tax.changedFromRoot')
  })

  it('keeps the card itself read-only for a holder of the VAT capability without the profile right', () => {
    expect(run(['settings.company.vat.manage']).state.vatLocked).toBe(true)
  })
})

describe('CompanyProfileForm: the VAT controls as rendered', () => {
  const find = (nodes: { name: string, props: Record<string, unknown> }[], name: string, testId?: string) =>
    nodes.find(node => node.name === name && (!testId || node.props['data-testid'] === testId))?.props

  it('shows the branch switch read-only with its reason and keeps the VAT number editable', async () => {
    const nodes = await renderControls(
      ['settings.company.manage', 'settings.company.vat.manage'],
      { ...PROFILE, vat_registered: true, vat_registration_editable: false, is_root_company: false } as CompanyProfile,
    )
    expect(find(nodes, 'SharedSettingRow')).toMatchObject({ name: 'vat_registered', 'disabled-reason': 'settings.company.tax.changedFromRoot' })
    expect(find(nodes, 'USwitch', 'company-vat-registered')).toMatchObject({ 'data-testid': 'company-vat-registered', disabled: true })
    // A branch keeps its own number; the server accepts that write, so only the card's own lock disables the field.
    expect(find(nodes, 'UInput', 'company-vat')).toMatchObject({ 'data-testid': 'company-vat', disabled: false })
  })

  it('keeps the switch and the number editable when the server allows it, with no disabled reason', async () => {
    const nodes = await renderControls(
      ['settings.company.manage', 'settings.company.vat.manage'],
      { ...PROFILE, vat_registered: true, vat_registration_editable: true } as CompanyProfile,
    )
    expect(find(nodes, 'SharedSettingRow')).toMatchObject({ 'disabled-reason': undefined })
    expect(find(nodes, 'USwitch', 'company-vat-registered')).toMatchObject({ 'data-testid': 'company-vat-registered', disabled: false })
    expect(find(nodes, 'UInput', 'company-vat')).toMatchObject({ 'data-testid': 'company-vat', disabled: false })
  })

  it('drops the switch but keeps the VAT number editable while the tax card owns the registration', async () => {
    const nodes = await renderControls(
      ['settings.company.manage', 'settings.company.vat.manage'],
      { ...PROFILE, vat_registered: true, vat_registration_editable: true, vat: '300000000000003' } as CompanyProfile,
      true,
    )
    expect(find(nodes, 'SharedSettingRow')).toBeUndefined()
    expect(find(nodes, 'USwitch', 'company-vat-registered')).toBeUndefined()
    expect(find(nodes, 'UInput', 'company-vat')).toMatchObject({ 'data-testid': 'company-vat', disabled: false })
  })

  it('lets a new establishment save its VAT number before registering in the tax card', async () => {
    const capabilities = ['settings.company.manage', 'settings.company.vat.manage']
    const nodes = await renderControls(capabilities, PROFILE, true)
    expect(find(nodes, 'USwitch', 'company-vat-registered')).toBeUndefined()
    expect(find(nodes, 'UInput', 'company-vat')).toMatchObject({ disabled: false })
    const { save, mutateAsync } = run(capabilities, PROFILE, true)
    await save({ vat: '300000000000003' })
    expect(mutateAsync).toHaveBeenCalledWith({ vat: '300000000000003' })
  })
})

describe('CompanyProfileForm: the tax card owns the registration', () => {
  const caps = ['settings.company.manage', 'settings.company.vat.manage']

  it('is not dirty when the tax query resolves after the profile query and the tax card takes the registration', async () => {
    const registered = { ...PROFILE, vat_registered: true, vat: '300000000000003' } as CompanyProfile
    const { props, state, stop } = runWithRealForm(registered, false)
    expect(state.state.dirty).toBe(false)
    props.taxOwnsVat = true
    await Vue.nextTick()
    expect(state.state.dirty).toBe(false)
    stop()
  })

  it('leaves the registration out of this card\'s draft and patch while the tax card owns it', async () => {
    const registered = { ...PROFILE, vat_registered: true, vat: '300000000000003' } as CompanyProfile
    const { save, mutateAsync } = run(caps, registered, true)
    // The tax card saves the registration itself; a profile save never resends it, even when a caller passes it.
    await save({ name: 'ليوان الجديدة', vat_registered: false })
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'ليوان الجديدة' })
  })

  it('lets a branch clear its own number while the tax card owns the registration', async () => {
    const branch = { ...PROFILE, vat_registered: true, vat_registration_editable: false, is_root_company: false, vat: '300000000000003' } as CompanyProfile
    const { save, mutateAsync } = run(caps, branch, true)
    await save({ vat: '' })
    expect(mutateAsync).toHaveBeenCalledWith({ vat: null })
  })
})

describe('CompanyProfileForm: the VAT number check', () => {
  const caps = ['settings.company.manage', 'settings.company.vat.manage']

  it('does not hold back an unrelated save of a registered company whose number is blank', async () => {
    const registered = { ...PROFILE, vat_registered: true, vat: null } as CompanyProfile
    const { save, mutateAsync } = run(caps, registered)
    await save({ name: 'ليوان الجديدة' })
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'ليوان الجديدة' })
  })

  it('refuses turning registration on without a number, naming the vat field', async () => {
    const { save, mutateAsync } = run(caps)
    await expect(save({ vat_registered: true })).rejects.toMatchObject({ field: 'vat' })
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('accepts turning registration on with a number', async () => {
    const { save, mutateAsync } = run(caps)
    await save({ vat_registered: true, vat: '300000000000003' })
    expect(mutateAsync).toHaveBeenCalledWith({ vat_registered: true, vat: '300000000000003' })
  })

  it('does not hold a branch to the establishment rule on its own number, which the server accepts', async () => {
    const branch = { ...PROFILE, vat_registered: true, vat_registration_editable: false, is_root_company: false, vat: '300000000000003' } as CompanyProfile
    const { save, mutateAsync } = run(caps, branch)
    await save({ vat: '' })
    expect(mutateAsync).toHaveBeenCalledWith({ vat: null })
  })
})
