import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { CompanyProfile } from '@liwan/contracts'
import { ApiError } from '../../../composables/useApi'
import { companyPatch, profileToForm, SECTION_FIELDS, sectionExtensions, vatNumberMissing } from '../../../utils/companyProfile'

const PROFILE = {
  id: 1, name: 'ليوان', logo_url: null, report_header: null, company_registry: '1010', vat_registered: false, vat: null,
  address: { street: null, street2: null, city: null, zip: null, state: null, country: { id: 1, name: 'السعودية' } },
  email: null, phone: null, website: null, extensions: [], completeness: { done: 1, total: 2 },
} as unknown as CompanyProfile

// The script of the profile card, compiled and run with the settings-form composable stubbed to hand back its options,
// so the save step runs exactly as the card wires it.
function run(capabilities: string[], profile: CompanyProfile = PROFILE) {
  const filename = new URL('../CompanyProfileForm.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'CompanyProfileForm' }).content
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
    useSettingsForm: (given: typeof options) => { options = given; draft.value = profileToForm(profile) as Record<string, unknown>; return { draft, state: Vue.ref({ saving: false, reloading: false }), save: vi.fn(), revert: vi.fn(), reload: vi.fn() } },
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup({ profile, section: 'profile' }, { expose: () => {}, emit: () => {} })))
  return { state, mutateAsync, save: (values: Record<string, unknown>) => options!.save({ ...profileToForm(profile), ...values }, profile) }
}

describe('CompanyProfileForm: who may change the VAT status', () => {
  it('locks the switch and the number for a company editor without the VAT capability', () => {
    const { state } = run(['settings.company.manage'])
    expect(state.editable).toBe(true)
    expect(state.locked).toBe(false)
    expect(state.vatEditable).toBe(false)
    expect(state.vatLocked).toBe(true)
  })

  it('unlocks them for the holder of settings.company.vat.manage', () => {
    const { state } = run(['settings.company.manage', 'settings.company.vat.manage'])
    expect(state.vatLocked).toBe(false)
  })

  it('keeps them locked for the VAT capability alone, because the card itself is not editable', () => {
    expect(run(['settings.company.vat.manage']).state.vatLocked).toBe(true)
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
})
