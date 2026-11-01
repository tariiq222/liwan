import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { HrInsuranceSettings } from '@liwan/contracts'
import { ApiError } from '../../../../composables/useApi'
import { saveErrorMessage } from '../../../../utils/formFeedback'

// The policy saves whole, with the revision it was read at. A 409 locks the form until the latest values are reloaded.
const FILE = resolve(import.meta.dirname, '../InsuranceSettingsForm.vue')

function settings(over: Partial<HrInsuranceSettings> = {}): HrInsuranceSettings {
  return { insurance_visibility: 'own_enrollment_and_dependents', insurance_expiry_alert_days: 60, insurance_require_dependent_id: false, revision: 2, ...over }
}

function mount(initial: HrInsuranceSettings, save: (input: unknown) => Promise<HrInsuranceSettings>, reloadSettings: () => Promise<HrInsuranceSettings>) {
  const descriptor = parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor
  const script = compileScript(descriptor, { id: 'insurance-settings-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    usePatchHrInsuranceSettings: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    ApiError, saveErrorMessage,
  }
  const component = new Function(...Object.keys(bindings), ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(...Object.values(bindings))
  const props = Vue.reactive({ settings: initial, canEdit: true, reloadSettings })
  return { props, state: component.setup(props, { expose: () => {}, emit: () => {} }) }
}

describe('InsuranceSettingsForm', () => {
  it('sends the whole policy with the revision it read and takes the saved values as the baseline', async () => {
    const save = vi.fn().mockResolvedValue(settings({ insurance_expiry_alert_days: 30, revision: 3 }))
    const { state } = mount(settings(), save, vi.fn())
    state.alertDays.value = 30
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledWith({ insurance_visibility: 'own_enrollment_and_dependents', insurance_expiry_alert_days: 30, insurance_require_dependent_id: false, revision: 2 })
    expect(state.dirty.value).toBe(false)
    expect(state.baseline.value.revision).toBe(3)
  })

  it('refuses an out-of-range window and locks on a conflict until the settings are reloaded', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    const reload = vi.fn().mockResolvedValue(settings({ insurance_visibility: 'own_enrollment_only', revision: 5 }))
    const { state } = mount(settings(), save, reload)
    state.alertDays.value = 0
    expect(state.validDays.value).toBe(false)
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    state.alertDays.value = 400
    expect(state.validDays.value).toBe(false)
    state.alertDays.value = 45
    await state.submit()
    expect(state.conflict.value).toBe(true)
    expect(state.message.value).toBe('hrInsurance.settings.conflict')
    await state.submit()
    expect(save).toHaveBeenCalledTimes(1)
    await state.reload()
    expect(state.conflict.value).toBe(false)
    expect(state.baseline.value.revision).toBe(5)
    expect(state.visibility.value).toBe('own_enrollment_only')
  })
})
