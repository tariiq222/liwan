import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'

// The leave policy is one SharedSettingsCard: its draft and revision come from useSettingsForm, and the card's `save`
// (driven by the page's one save bar) runs the form's submit. A save after someone else's answers 409, keeps the draft
// and locks the card until the current policy is reloaded explicitly.
const filename = resolve(import.meta.dirname, '../LeaveSettingsForm.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const code = ts.transpileModule(
  compileScript(descriptor, { id: 'leave-settings' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText

type Policy = 'manager_approval' | 'direct_employee' | 'manager_only'
const settings = (over: { cancellation_policy?: Policy; revision?: number } = {}) => ({
  cancellation_policy: 'manager_approval' as Policy,
  revision: 0,
  ...over,
})

function load({
  save = vi.fn(async (body: { cancellation_policy: Policy; revision: number }) => settings({ cancellation_policy: body.cancellation_policy, revision: body.revision + 1 })),
  initial = settings(),
  reloadSettings = vi.fn(),
} = {}) {
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useSaveHrLeaveSettings: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    useSettingsForm,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const props = Vue.reactive({ settings: initial, canEdit: true, reloadSettings })
  return { props, save, reloadSettings, form: component.setup(props, { expose: () => {}, emit: vi.fn() }) }
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('leave policy draft', () => {
  it('offers all three policies and saves the draft with the revision it read', async () => {
    const { form, save } = load()
    expect(form.items.value.map((item: { value: string }) => item.value)).toEqual(['manager_approval', 'direct_employee', 'manager_only'])
    form.draft.value.cancellation_policy = 'manager_only'
    expect(form.state.value.dirty).toBe(true)
    await form.submit()
    expect(save).toHaveBeenCalledWith({ cancellation_policy: 'manager_only', revision: 0 })
    expect(form.state.value.dirty).toBe(false)
  })

  it('keeps the draft, locks on a 409 and saves again only after an explicit reload', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'changed'))
    const reloadSettings = vi.fn(async () => settings({ cancellation_policy: 'manager_only', revision: 4 }))
    const { form } = load({ save, initial: settings({ revision: 3 }), reloadSettings })
    form.draft.value.cancellation_policy = 'direct_employee'
    await form.submit()
    expect(form.state.value.conflict).toBe(true)
    expect(form.state.value.message).toBe('app.settingsConflict')
    expect(form.draft.value.cancellation_policy).toBe('direct_employee')
    // The card is locked: a second press writes nothing.
    await form.submit()
    expect(save).toHaveBeenCalledTimes(1)
    await form.reload()
    expect(reloadSettings).toHaveBeenCalledTimes(1)
    expect(form.state.value.conflict).toBe(false)
    expect(form.draft.value.cancellation_policy).toBe('manager_only')
  })

  it('keeps the draft across a background refetch and saves with the newest revision the page knows', async () => {
    const { form, props, save } = load({ initial: settings({ revision: 2 }) })
    form.draft.value.cancellation_policy = 'direct_employee'
    // The page refetched and the policy this card owns is unchanged, so the draft stays editable.
    props.settings = settings({ revision: 5 })
    await Vue.nextTick()
    expect(form.state.value.conflict).toBe(false)
    expect(form.draft.value.cancellation_policy).toBe('direct_employee')
    await form.submit()
    expect(save).toHaveBeenCalledWith({ cancellation_policy: 'direct_employee', revision: 5 })
  })

  it('locks a dirty card when a refetch changed the policy it owns, instead of overwriting the draft', async () => {
    const { form, props } = load({ initial: settings({ revision: 2 }) })
    form.draft.value.cancellation_policy = 'direct_employee'
    props.settings = settings({ cancellation_policy: 'manager_only', revision: 3 })
    await Vue.nextTick()
    expect(form.state.value.conflict).toBe(true)
    expect(form.draft.value.cancellation_policy).toBe('direct_employee')
  })

  it('a failed reload keeps the draft and the conflict, and another reload recovers', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'changed'))
    const reloadSettings = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(settings({ cancellation_policy: 'manager_only', revision: 4 }))
    const { form } = load({ save, initial: settings({ revision: 3 }), reloadSettings })
    form.draft.value.cancellation_policy = 'direct_employee'
    await form.submit()
    await form.reload()
    expect(form.state.value.reloadFailed).toBe(true)
    expect(form.state.value.conflict).toBe(true)
    expect(form.draft.value.cancellation_policy).toBe('direct_employee')
    await form.reload()
    expect(form.state.value.reloadFailed).toBe(false)
    expect(form.state.value.conflict).toBe(false)
    expect(form.draft.value.cancellation_policy).toBe('manager_only')
  })
})
