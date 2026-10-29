import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { saveErrorMessage } from '../../../utils/formFeedback'

const filename = new URL('../MeetingScheduleCard.vue', import.meta.url).pathname

const settings = (policy: 'all_employees' | 'organizers_only', revision: number) => ({
  values: { schedule_policy: policy },
  defaults: { schedule_policy: 'organizers_only' as const },
  options: { schedule_policy: ['all_employees', 'organizers_only'] as Array<'all_employees' | 'organizers_only'> },
  revision,
})

// The component script is compiled and run against stubbed composables, as the page tests do.
function mountCard(props: { settings: ReturnType<typeof settings>; reloadSettings: () => Promise<ReturnType<typeof settings>> }) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'meeting-schedule-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const save = { mutateAsync: vi.fn(), isPending: Vue.ref(false) }
  const toast = { add: vi.fn() }
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, ApiError, saveErrorMessage,
    useI18n: () => ({ t: (key: string) => key }), useToast: () => toast, useHydrated: () => Vue.ref(true),
    useSaveMeetingSettings: () => save,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = component.setup(Vue.reactive(props), { expose: () => {}, emit: () => {} })
  return { state, save, toast }
}

describe('MeetingScheduleCard', () => {
  it('lists the server options with their Arabic and English labels from the locale', () => {
    const { state } = mountCard({ settings: settings('organizers_only', 0), reloadSettings: vi.fn() })
    expect(state.items.value.map((item: { value: string; label: string }) => [item.value, item.label])).toEqual([
      ['all_employees', 'meetingsSettings.schedule.all_employees'],
      ['organizers_only', 'meetingsSettings.schedule.organizers_only'],
    ])
    expect(state.dirty.value).toBe(false)
  })

  it('saves the chosen policy with the revision it was made from', async () => {
    const { state, save, toast } = mountCard({ settings: settings('organizers_only', 3), reloadSettings: vi.fn() })
    save.mutateAsync.mockResolvedValue(settings('all_employees', 4))
    state.policy.value = 'all_employees'
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(save.mutateAsync).toHaveBeenCalledWith({ revision: 3, values: { schedule_policy: 'all_employees' } })
    expect(state.dirty.value).toBe(false)
    expect(toast.add).toHaveBeenCalledWith({ title: 'meetingsSettings.saved', color: 'success' })
  })

  it('saves nothing while the choice is unchanged', async () => {
    const { state, save } = mountCard({ settings: settings('organizers_only', 0), reloadSettings: vi.fn() })
    await state.submit()
    expect(save.mutateAsync).not.toHaveBeenCalled()
  })

  it('reads the saved settings again and warns when another session saved first (409)', async () => {
    const reloadSettings = vi.fn(async () => settings('all_employees', 5))
    const { state, save } = mountCard({ settings: settings('organizers_only', 3), reloadSettings })
    save.mutateAsync.mockRejectedValue(new ApiError(409, 'conflict', 'stale'))
    state.policy.value = 'all_employees'
    await state.submit()
    expect(reloadSettings).toHaveBeenCalledOnce()
    expect(state.notice.value).toBe('conflict')
    expect(state.policy.value).toBe('all_employees')
    expect(state.dirty.value).toBe(false)
  })

  it('shows the server message of a refused save', async () => {
    const { state, save } = mountCard({ settings: settings('organizers_only', 3), reloadSettings: vi.fn() })
    save.mutateAsync.mockRejectedValue(new ApiError(422, 'invalid', 'schedule_policy must be one of: all_employees, organizers_only', 'schedule_policy'))
    state.policy.value = 'all_employees'
    await state.submit()
    expect(state.failure.value).toBe('schedule_policy must be one of: all_employees, organizers_only')
  })
})
