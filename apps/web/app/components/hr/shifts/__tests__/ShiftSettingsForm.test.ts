import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../composables/useApi'
import { saveErrorMessage } from '../../../../utils/formFeedback'

const initial = { day_reference: 'company', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh', today: '2026-10-23', default_schedule: { id: 7, name: 'Sun-Thu' }, revision: 0 }
const schedules = { items: [{ id: 7, name: 'Sun-Thu' }, { id: 9, name: 'Every day' }] }
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
    useHrShiftSchedules: () => ({ data: Vue.ref(schedules) }),
    ApiError, saveErrorMessage,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const reloadSettings = vi.fn(async () => ({ ...initial }))
  const props = Vue.reactive({ settings: { ...initial }, canEdit, reloadSettings })
  reloadSettings.mockImplementation(async () => ({ ...props.settings }))
  const state = component.setup(props, { expose: () => {}, emit })
  return { state, props, save, emit, reloadSettings }
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
  it('offers the active schedules and always keeps the current default selectable', () => {
    const { state, props } = load()
    expect(state.scheduleItems.value).toEqual([{ value: 7, label: 'Sun-Thu' }, { value: 9, label: 'Every day' }])
    props.settings = { ...initial, default_schedule: { id: 3, name: 'Archived week' } }
    state.baseline.value = props.settings
    expect(state.scheduleItems.value[0]).toEqual({ value: 3, label: 'Archived week' })
  })
  it('sends the default schedule only when it changed', async () => {
    const { state, save } = load()
    state.defaultSchedule.value = 9
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledWith({ day_reference: 'company', default_schedule_id: 9, revision: 0 })
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
    const { state, props, save, reloadSettings } = load()
    state.reference.value = 'user'
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    await state.submit()
    expect(state.dirty.value).toBe(true)
    expect(state.conflict.value).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledTimes(1)
    props.settings = { ...initial, revision: 4 }
    await state.reload()
    expect(state.baseline.value.revision).toBe(4)
    expect(state.dirty.value).toBe(false)
    expect(reloadSettings).toHaveBeenCalledTimes(1)
  })
  it('keeps the conflicted draft blocked until a delayed reload succeeds', async () => {
    const { state, save, reloadSettings } = load()
    state.reference.value = 'user'
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    await state.submit()
    let resolveReload!: (settings: typeof initial) => void
    reloadSettings.mockImplementationOnce(() => new Promise(resolve => { resolveReload = resolve }))
    const reloading = state.reload()
    expect(state.reference.value).toBe('user')
    expect(state.baseline.value.revision).toBe(0)
    expect(state.conflict.value).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledTimes(1)
    resolveReload({ ...initial, revision: 4 })
    await reloading
    expect(state.reference.value).toBe('company')
    expect(state.baseline.value.revision).toBe(4)
    expect(state.conflict.value).toBe(false)
    expect(state.dirty.value).toBe(false)
  })
  it('retains draft and conflict when reloading fails and allows another reload', async () => {
    const { state, save, reloadSettings } = load()
    state.reference.value = 'user'
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    await state.submit()
    reloadSettings.mockRejectedValueOnce(new Error('offline'))
    await state.reload()
    expect(state.reference.value).toBe('user')
    expect(state.baseline.value.revision).toBe(0)
    expect(state.conflict.value).toBe(true)
    expect(state.dirty.value).toBe(true)
    reloadSettings.mockResolvedValueOnce({ ...initial, revision: 5 })
    await state.reload()
    expect(state.baseline.value.revision).toBe(5)
    expect(state.conflict.value).toBe(false)
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
