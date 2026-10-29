import { describe, expect, it } from 'vitest'
import { MeetingSettingsPatchSchema, MeetingSettingsSchema } from '..'

// The body `GET /api/v1/meetings/settings` answers for a company that never saved the setting.
const DEFAULT_BODY = {
  values: { schedule_policy: 'organizers_only' },
  defaults: { schedule_policy: 'organizers_only' },
  options: { schedule_policy: ['all_employees', 'organizers_only'] },
  revision: 0,
}

describe('meetings schedule policy contract', () => {
  it('parses the server body with the stated default', () => {
    expect(MeetingSettingsSchema.parse(DEFAULT_BODY)).toEqual(DEFAULT_BODY)
  })

  it('refuses an unknown policy or key', () => {
    expect(() => MeetingSettingsSchema.parse({ ...DEFAULT_BODY, values: { schedule_policy: 'everyone' } })).toThrow()
    expect(() => MeetingSettingsSchema.parse({ ...DEFAULT_BODY, extra: true })).toThrow()
  })

  it('builds the patch the server accepts and nothing else', () => {
    const patch = { revision: 1, values: { schedule_policy: 'all_employees' as const } }
    expect(MeetingSettingsPatchSchema.parse(patch)).toEqual(patch)
    expect(() => MeetingSettingsPatchSchema.parse({ revision: -1, values: patch.values })).toThrow()
    expect(() => MeetingSettingsPatchSchema.parse({ revision: 0, values: { schedule_policy: 'all_employees', other: 1 } })).toThrow()
  })
})
