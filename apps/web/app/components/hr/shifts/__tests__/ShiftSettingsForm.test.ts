import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../composables/useApi'
import { useSettingsForm } from '../../../../composables/settings/useSettingsForm'

// The shift reference is one SharedSettingsCard: its draft and revision come from useSettingsForm, and the card's `save`
// (driven by the page's one save bar) runs the form's submit. It sends only the fields it changed, with the revision the
// manager read; a save after someone else's answers 409, keeps the draft and locks the card until a reload.
const initial = { day_reference: 'company', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh', today: '2026-10-23', default_schedule: { id: 7, name: 'Sun-Thu' }, revision: 0 }
const schedules = { items: [{ id: 7, name: 'Sun-Thu' }, { id: 9, name: 'Every day' }] }
const filename = resolve(import.meta.dirname, '../ShiftSettingsForm.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const code = ts.transpileModule(
  compileScript(descriptor, { id: 'shift-settings-form' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
).outputText

function load(hydrated = true, canEdit = true) {
  const save = vi.fn(async () => ({ ...initial, day_reference: 'user' as const, revision: 1 }))
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(hydrated),
    usePatchHrShiftSettings: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    useHrShiftSchedules: () => ({ data: Vue.ref(schedules) }),
    useSettingsForm,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const reloadSettings = vi.fn(async () => ({ ...initial }))
  const props = Vue.reactive({ settings: { ...initial }, canEdit, reloadSettings })
  reloadSettings.mockImplementation(async () => ({ ...props.settings }))
  return { props, save, reloadSettings, form: component.setup(props, { expose: () => {}, emit: vi.fn() }) }
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('shift settings draft', () => {
  it.each([[false, true], [true, false]])('does not submit before hydration or without permission', async (hydrated, canEdit) => {
    const { form, save } = load(hydrated, canEdit)
    form.draft.value.day_reference = 'user'
    await form.submit()
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the draft across a background refresh that left its fields alone and saves with the refreshed revision', async () => {
    const { form, props, save } = load()
    form.draft.value.day_reference = 'user'
    props.settings = { ...initial, revision: 2 }
    await Vue.nextTick()
    expect(form.state.value.conflict).toBe(false)
    expect(form.draft.value.day_reference).toBe('user')
    await form.submit()
    expect(save).toHaveBeenCalledWith({ day_reference: 'user', revision: 2 })
    expect(form.state.value.dirty).toBe(false)
  })

  it('offers the active schedules and always keeps the current default selectable', () => {
    const { form, props } = load()
    expect(form.scheduleItems.value).toEqual([{ value: 7, label: 'Sun-Thu' }, { value: 9, label: 'Every day' }])
    props.settings = { ...initial, default_schedule: { id: 3, name: 'Archived week' } }
    expect(form.scheduleItems.value[0]).toEqual({ value: 3, label: 'Archived week' })
  })

  it('sends the default schedule only when it changed', async () => {
    const { form, save } = load()
    form.draft.value.defaultSchedule = 9
    expect(form.state.value.dirty).toBe(true)
    await form.submit()
    expect(save).toHaveBeenCalledWith({ day_reference: 'company', default_schedule_id: 9, revision: 0 })
  })

  it('refreshes a clean form from server state', async () => {
    const { form, props } = load()
    props.settings = { ...initial, day_reference: 'user', revision: 2 }
    await Vue.nextTick()
    expect(form.draft.value.day_reference).toBe('user')
    expect(form.state.value.dirty).toBe(false)
  })

  it('preserves a rejected draft, prevents repeat conflict writes and reloads explicitly', async () => {
    const { form, props, save, reloadSettings } = load()
    form.draft.value.day_reference = 'user'
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    await form.submit()
    expect(form.state.value.dirty).toBe(true)
    expect(form.state.value.conflict).toBe(true)
    await form.submit()
    expect(save).toHaveBeenCalledTimes(1)
    props.settings = { ...initial, revision: 4 }
    await form.reload()
    expect(form.state.value.dirty).toBe(false)
    expect(form.state.value.conflict).toBe(false)
    expect(reloadSettings).toHaveBeenCalledTimes(1)
  })

  it('keeps the conflicted draft blocked until a delayed reload succeeds', async () => {
    const { form, save, reloadSettings } = load()
    form.draft.value.day_reference = 'user'
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    await form.submit()
    let resolveReload!: (settings: typeof initial) => void
    reloadSettings.mockImplementationOnce(() => new Promise(resolve => { resolveReload = resolve }))
    const reloading = form.reload()
    expect(form.draft.value.day_reference).toBe('user')
    expect(form.state.value.conflict).toBe(true)
    await form.submit()
    expect(save).toHaveBeenCalledTimes(1)
    resolveReload({ ...initial, revision: 4 })
    await reloading
    expect(form.draft.value.day_reference).toBe('company')
    expect(form.state.value.conflict).toBe(false)
    expect(form.state.value.dirty).toBe(false)
  })

  it('retains draft and conflict when reloading fails and allows another reload', async () => {
    const { form, save, reloadSettings } = load()
    form.draft.value.day_reference = 'user'
    save.mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed'))
    await form.submit()
    reloadSettings.mockRejectedValueOnce(new Error('offline'))
    await form.reload()
    expect(form.draft.value.day_reference).toBe('user')
    expect(form.state.value.conflict).toBe(true)
    expect(form.state.value.reloadFailed).toBe(true)
    expect(form.state.value.dirty).toBe(true)
    reloadSettings.mockResolvedValueOnce({ ...initial, revision: 5 })
    await form.reload()
    expect(form.state.value.conflict).toBe(false)
    expect(form.state.value.reloadFailed).toBe(false)
    expect(form.state.value.dirty).toBe(false)
  })

  it('preserves edits when saving fails and clears dirty only on success', async () => {
    const { form, save } = load()
    form.draft.value.day_reference = 'user'
    save.mockRejectedValueOnce(new Error('offline'))
    await form.submit()
    expect(form.state.value.dirty).toBe(true)
    expect(form.state.value.message).toBe('errors.generic')
    await form.submit()
    expect(form.state.value.dirty).toBe(false)
  })

  it('a reader without manage sees the fields disabled', () => {
    const { form } = load(true, false)
    expect(form.locked.value).toBe(true)
  })
})
