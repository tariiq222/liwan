import { describe, expect, it } from 'vitest'
import { MeetingSettingsPatchSchema, MeetingSettingsSchema } from '..'

// The body `GET /api/v1/meetings/settings` answers for a company that never saved the settings.
const DEFAULT_BODY = {
  values: { schedule_policy: 'organizers_only', reminder_hours: 24, reference_prefix: 'MIN' },
  defaults: { schedule_policy: 'organizers_only', reminder_hours: 24, reference_prefix: 'MIN' },
  options: {
    schedule_policy: ['all_employees', 'organizers_only'],
    reminder_hours: { min: 1, max: 168 },
    reference_prefix: { pattern: '[A-Z0-9]{1,10}', max_length: 10 },
  },
  revision: 0,
}

describe('meetings settings contract', () => {
  it('parses the server body with the stated defaults', () => {
    expect(MeetingSettingsSchema.parse(DEFAULT_BODY)).toEqual(DEFAULT_BODY)
  })

  it('refuses an unknown policy or key', () => {
    expect(() => MeetingSettingsSchema.parse({ ...DEFAULT_BODY, values: { ...DEFAULT_BODY.values, schedule_policy: 'everyone' } })).toThrow()
    expect(() => MeetingSettingsSchema.parse({ ...DEFAULT_BODY, extra: true })).toThrow()
    expect(() => MeetingSettingsSchema.parse({
      ...DEFAULT_BODY,
      values: { ...DEFAULT_BODY.values, other: 1 },
    })).toThrow()
  })

  it.each([0, 169, 24.5])('refuses the reminder window %s outside 1..168 whole hours', (reminder_hours) => {
    expect(() => MeetingSettingsSchema.parse({
      ...DEFAULT_BODY,
      values: { ...DEFAULT_BODY.values, reminder_hours },
    })).toThrow()
  })

  it.each(['', 'min', 'MIN-1', 'ABCDEFGHIJK'])('refuses the reference prefix %j outside A-Z and 0-9, 1 to 10', (reference_prefix) => {
    expect(() => MeetingSettingsSchema.parse({
      ...DEFAULT_BODY,
      values: { ...DEFAULT_BODY.values, reference_prefix },
    })).toThrow()
  })

  it('accepts the window bounds and a 10-character prefix', () => {
    for (const reminder_hours of [1, 168]) {
      expect(MeetingSettingsSchema.parse({
        ...DEFAULT_BODY,
        values: { ...DEFAULT_BODY.values, reminder_hours, reference_prefix: 'ABCDEFGHIJ' },
      }).values.reminder_hours).toBe(reminder_hours)
    }
  })

  it('builds the partial patch the server accepts and nothing else', () => {
    for (const patch of [
      { revision: 1, values: { schedule_policy: 'all_employees' as const } },
      { revision: 1, values: { reminder_hours: 48 } },
      { revision: 1, values: { reference_prefix: 'OPS1' } },
      { revision: 1, values: { schedule_policy: 'all_employees' as const, reminder_hours: 2, reference_prefix: 'A' } },
    ]) {
      expect(MeetingSettingsPatchSchema.parse(patch)).toEqual(patch)
    }
    expect(() => MeetingSettingsPatchSchema.parse({ revision: -1, values: { reminder_hours: 48 } })).toThrow()
    expect(() => MeetingSettingsPatchSchema.parse({ revision: 0, values: {} })).toThrow()
    expect(() => MeetingSettingsPatchSchema.parse({ revision: 0, values: { reminder_hours: 0 } })).toThrow()
    expect(() => MeetingSettingsPatchSchema.parse({ revision: 0, values: { reminder_hours: 169 } })).toThrow()
    expect(() => MeetingSettingsPatchSchema.parse({ revision: 0, values: { reference_prefix: 'min' } })).toThrow()
    expect(() => MeetingSettingsPatchSchema.parse({ revision: 0, values: { schedule_policy: 'all_employees', other: 1 } })).toThrow()
  })
})
