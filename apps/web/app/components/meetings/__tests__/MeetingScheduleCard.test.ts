import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'

const filename = new URL('../MeetingScheduleCard.vue', import.meta.url).pathname

const settings = (policy: 'all_employees' | 'organizers_only', revision: number) => ({
  values: { schedule_policy: policy, reminder_hours: 24, reference_prefix: 'MIN' },
  defaults: { schedule_policy: 'organizers_only' as const, reminder_hours: 24, reference_prefix: 'MIN' },
  options: {
    schedule_policy: ['all_employees', 'organizers_only'] as Array<'all_employees' | 'organizers_only'>,
    reminder_hours: { min: 1, max: 168 },
    reference_prefix: { pattern: '[A-Z0-9]{1,10}', max_length: 10 },
  },
  revision,
})

// The component script is compiled and run against stubbed composables, as the page tests do.
function mountCard(props: { settings: ReturnType<typeof settings>; canEdit?: boolean; reloadSettings?: () => Promise<ReturnType<typeof settings>> }) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'meeting-schedule-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutateAsync = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    MEETING_REFERENCE_PREFIX_PATTERN: /^[A-Z0-9]{1,10}$/,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useSaveMeetingSettings: () => ({ mutateAsync }), useSettingsForm,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const card = component.setup(Vue.reactive({ canEdit: true, reloadSettings: vi.fn(), ...props }), { expose: () => {}, emit: () => {} })
  return { card, mutateAsync }
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('MeetingScheduleCard', () => {
  it('marks the reminder window and the reference prefix as required fields', () => {
    // DESIGN.md: every form field is a UFormField with label, required and help; both settings are mandatory.
    const template = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.template?.content ?? ''
    for (const name of ['reminder_hours', 'reference_prefix']) {
      const field = template.match(new RegExp(`<UFormField[^>]*name="${name}"[^>]*>`))?.[0] ?? ''
      expect(field, name).toMatch(/\srequired[\s>]/)
      expect(field, name).toContain(':description=')
    }
  })

  it('is two settings cards: who schedules, and the reminders with the reference prefix', () => {
    const template = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.template?.content ?? ''
    expect([...template.matchAll(/<SharedSettingsCard id="([^"]+)"/g)].map(match => match[1])).toEqual(['meetings-schedule', 'meetings-reminders'])
    expect(template).not.toContain('SharedFormActions')
  })

  it('lists the server options with their Arabic and English labels from the locale', () => {
    const { card } = mountCard({ settings: settings('organizers_only', 0) })
    expect(card.items.value.map((item: { value: string; label: string }) => [item.value, item.label])).toEqual([
      ['all_employees', 'meetingsSettings.schedule.all_employees'],
      ['organizers_only', 'meetingsSettings.schedule.organizers_only'],
    ])
    expect(card.schedule.state.value.dirty).toBe(false)
    expect(card.reminders.state.value.dirty).toBe(false)
    expect(card.reminderError.value).toBeUndefined()
    expect(card.prefixError.value).toBeUndefined()
  })

  it('saves the chosen policy alone with the newest revision', async () => {
    const { card, mutateAsync } = mountCard({ settings: settings('organizers_only', 3) })
    mutateAsync.mockResolvedValue(settings('all_employees', 4))
    card.schedule.draft.value.schedule_policy = 'all_employees'
    expect(card.schedule.state.value.dirty).toBe(true)
    expect(card.reminders.state.value.dirty).toBe(false)
    await card.submitSchedule()
    expect(mutateAsync).toHaveBeenCalledWith({ revision: 3, values: { schedule_policy: 'all_employees' } })
    expect(card.schedule.state.value.dirty).toBe(false)
  })

  it('saves the reminder window and the prefix together, leaving the policy out', async () => {
    const { card, mutateAsync } = mountCard({ settings: settings('organizers_only', 3) })
    mutateAsync.mockResolvedValue(settings('organizers_only', 4))
    card.reminders.draft.value.reminder_hours = 48
    card.reminders.draft.value.reference_prefix = 'MTG'
    await card.submitReminders()
    expect(mutateAsync).toHaveBeenCalledWith({ revision: 3, values: { reminder_hours: 48, reference_prefix: 'MTG' } })
  })

  it('saves nothing while the values are unchanged', async () => {
    const { card, mutateAsync } = mountCard({ settings: settings('organizers_only', 0) })
    await card.submitSchedule()
    await card.submitReminders()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('blocks an out-of-range reminder window and an invalid prefix at their fields', async () => {
    const { card, mutateAsync } = mountCard({ settings: settings('organizers_only', 3) })
    card.reminders.draft.value.reminder_hours = 0
    expect(card.reminderError.value).toBe('meetingsSettings.reminders.hoursRange')
    await card.submitReminders()
    expect(mutateAsync).not.toHaveBeenCalled()
    card.reminders.draft.value.reminder_hours = 48
    card.reminders.draft.value.reference_prefix = 'min'
    expect(card.prefixError.value).toBe('meetingsSettings.reminders.prefixInvalid')
    await card.submitReminders()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('saves nothing for a viewer who may not edit', async () => {
    const { card, mutateAsync } = mountCard({ settings: settings('organizers_only', 3), canEdit: false })
    card.schedule.draft.value.schedule_policy = 'all_employees'
    await card.submitSchedule()
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(card.locked(card.schedule)).toBe(true)
  })

  it('keeps the draft and locks on a 409 until the saved settings are reloaded', async () => {
    const reloadSettings = vi.fn(async () => settings('all_employees', 5))
    const { card, mutateAsync } = mountCard({ settings: settings('organizers_only', 3), reloadSettings })
    mutateAsync.mockRejectedValue(new ApiError(409, 'conflict', 'stale'))
    card.schedule.draft.value.schedule_policy = 'all_employees'
    await card.submitSchedule()
    expect(card.schedule.state.value.conflict).toBe(true)
    await card.submitSchedule()
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    await card.schedule.reload()
    expect(reloadSettings).toHaveBeenCalledOnce()
    expect(card.schedule.state.value.conflict).toBe(false)
    expect(card.schedule.draft.value.schedule_policy).toBe('all_employees')
    expect(card.schedule.state.value.dirty).toBe(false)
  })

  it('shows the server message of a refused save inside the card', async () => {
    const { card, mutateAsync } = mountCard({ settings: settings('organizers_only', 3) })
    mutateAsync.mockRejectedValue(new ApiError(422, 'invalid', 'reference_prefix must match [A-Z0-9]{1,10}', 'reference_prefix'))
    card.reminders.draft.value.reference_prefix = 'MTG'
    await card.submitReminders()
    expect(card.reminders.state.value.message).toBe('reference_prefix must match [A-Z0-9]{1,10}')
    expect(card.schedule.state.value.message).toBe('')
  })
})
