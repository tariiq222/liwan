import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HrInsuranceSettings } from '@liwan/contracts'
import { ApiError } from '../../../../composables/useApi'
import { useSettingsForm } from '../../../../composables/settings/useSettingsForm'

// The insurance policy is one SharedSettingsCard: its draft and revision come from useSettingsForm, and the card's `save`
// (driven by the page's one save bar) runs the form's submit. It sends the whole policy with the revision it read, refuses
// an out-of-range window at its field, and a 409 locks the card until the current policy is reloaded.
const FILE = resolve(import.meta.dirname, '../InsuranceSettingsForm.vue')
const script = compileScript(parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor, { id: 'insurance-settings-form' }).content
  .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText

function settings(over: Partial<HrInsuranceSettings> = {}): HrInsuranceSettings {
  return { insurance_visibility: 'own_enrollment_and_dependents', insurance_expiry_alert_days: 60, insurance_require_dependent_id: false, revision: 2, ...over }
}

function mount(initial: HrInsuranceSettings, save: (input: unknown) => Promise<HrInsuranceSettings>, reloadSettings: () => Promise<HrInsuranceSettings>, canEdit = true) {
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}|${JSON.stringify(params)}` : key }),
    useHydrated: () => Vue.ref(true),
    usePatchHrInsuranceSettings: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    useSettingsForm,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const props = Vue.reactive({ settings: initial, canEdit, reloadSettings })
  return { props, form: component.setup(props, { expose: () => {}, emit: () => {} }) }
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('InsuranceSettingsForm', () => {
  it('sends the whole policy with the revision it read and takes the saved values as the baseline', async () => {
    const save = vi.fn().mockResolvedValue(settings({ insurance_expiry_alert_days: 30, revision: 3 }))
    const { form } = mount(settings(), save, vi.fn())
    form.draft.value.insurance_expiry_alert_days = 30
    expect(form.state.value.dirty).toBe(true)
    await form.submit()
    expect(save).toHaveBeenCalledWith({ insurance_visibility: 'own_enrollment_and_dependents', insurance_expiry_alert_days: 30, insurance_require_dependent_id: false, revision: 2 })
    expect(form.state.value.dirty).toBe(false)
  })

  it('refuses an out-of-range window at its field without sending it, and locks on a conflict until reloaded', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    const reload = vi.fn().mockResolvedValue(settings({ insurance_visibility: 'own_enrollment_only', revision: 5 }))
    const { form } = mount(settings(), save, reload)
    form.draft.value.insurance_expiry_alert_days = 0
    expect(form.daysError.value).toBeTruthy()
    await form.submit()
    expect(save).not.toHaveBeenCalled()
    form.draft.value.insurance_expiry_alert_days = 400
    expect(form.daysError.value).toBeTruthy()
    await form.submit()
    expect(save).not.toHaveBeenCalled()
    form.draft.value.insurance_expiry_alert_days = 45
    expect(form.daysError.value).toBeUndefined()
    await form.submit()
    expect(form.state.value.conflict).toBe(true)
    expect(form.state.value.message).toBe('app.settingsConflict')
    await form.submit()
    expect(save).toHaveBeenCalledTimes(1)
    await form.reload()
    expect(form.state.value.conflict).toBe(false)
    expect(form.draft.value.insurance_visibility).toBe('own_enrollment_only')
  })

  it('a reader sees the fields disabled and sends nothing', async () => {
    const save = vi.fn()
    const { form } = mount(settings(), save, vi.fn(), false)
    expect(form.locked.value).toBe(true)
    form.draft.value.insurance_expiry_alert_days = 90
    await form.submit()
    expect(save).not.toHaveBeenCalled()
  })
})
