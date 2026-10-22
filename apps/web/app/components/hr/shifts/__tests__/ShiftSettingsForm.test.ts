import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../composables/useApi'
import { saveErrorMessage } from '../../../../utils/formFeedback'

const initial = { day_reference: 'company', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh', today: '2026-10-23', revision: 0 }
function load(hydrated = true, canEdit = true) {
  const filename = resolve(import.meta.dirname, '../ShiftSettingsForm.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'shift-settings-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const save = vi.fn(async () => ({ ...initial, day_reference: 'user', revision: 1 }))
  const emit = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(hydrated),
    usePatchHrShiftSettings: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    ApiError, saveErrorMessage,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const props = Vue.reactive({ settings: { ...initial }, canEdit })
  const state = component.setup(props, { expose: () => {}, emit })
  return { state, props, save, emit }
}

describe('shift settings draft', () => {
  it.each([[false, true], [true, false]])('does not submit before hydration or without permission', async (hydrated, canEdit) => {
    const { state, save } = load(hydrated, canEdit)
    state.reference.value = 'user'
    await state.submit()
    expect(save).not.toHaveBeenCalled()
  })
  it('keeps the draft and its revision across background refreshes and saves with original revision', async () => {
    const { state, props, save } = load()
    state.reference.value = 'user'
    props.settings = { ...initial, revision: 2 }
    await Vue.nextTick()
    expect(state.baseline.value.revision).toBe(0)
    expect(state.reference.value).toBe('user')
    await state.submit()
    expect(save).toHaveBeenCalledWith({ day_reference: 'user', revision: 0 })
    expect(state.dirty.value).toBe(false)
  })
  it('refreshes a clean form from server state', async () => {
    const { state, props } = load()
    props.settings = { ...initial, day_reference: 'user', revision: 2 }
    await Vue.nextTick()
    expect(state.reference.value).toBe('user')
    expect(state.baseline.value.revision).toBe(2)
    expect(state.dirty.value).toBe(false)
  })
  it('preserves a rejected draft, prevents repeat conflict writes and reloads explicitly', async () => {
    const { state, props, save, emit } = load()
    state.reference.value = 'user'
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    await state.submit()
    expect(state.dirty.value).toBe(true)
    expect(state.conflict.value).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledTimes(1)
    props.settings = { ...initial, revision: 4 }
    state.reload()
    expect(state.baseline.value.revision).toBe(4)
    expect(state.dirty.value).toBe(false)
    expect(emit).toHaveBeenCalledWith('reload')
  })
  it('preserves edits when saving fails and clears dirty only on success', async () => {
    const { state, save } = load()
    state.reference.value = 'user'
    save.mockRejectedValueOnce(new Error('offline'))
    await state.submit()
    expect(state.dirty.value).toBe(true)
    expect(state.message.value).toBe('errors.generic')
    await state.submit()
    expect(state.dirty.value).toBe(false)
  })
})
