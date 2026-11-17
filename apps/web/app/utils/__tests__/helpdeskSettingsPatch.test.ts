import { describe, expect, it } from 'vitest'
import { plainTextFromHtml } from '../meetingMinutesForm'
import { buildHelpdeskSettingsPatch } from '../helpdeskSettingsPatch'

const draft = {
  preset: 'it', visibility: 'team' as const, default_team_id: null, default_priority: '1' as const,
  reference_prefix: 'HD', reopen_days: 7, first_response_hours: 8, resolution_hours: 72,
  portal_enabled: true, auto_close_days: 0, auto_close_stage_ids: [],
}

describe('buildHelpdeskSettingsPatch', () => {
  it('leaves the preset bundle to the server when the preset changed', () => {
    const patch = buildHelpdeskSettingsPatch(draft, 'general', 3)
    expect(patch).toMatchObject({ revision: 3, preset: 'it', reference_prefix: 'HD', portal_enabled: true })
    for (const key of ['visibility', 'default_priority', 'reopen_days', 'first_response_hours', 'resolution_hours']) {
      expect(patch).not.toHaveProperty(key)
    }
  })
  it('sends the whole draft when the preset is unchanged', () => {
    expect(buildHelpdeskSettingsPatch(draft, 'it', 3)).toEqual({ revision: 3, ...draft })
  })
})

describe('ticket description for editing', () => {
  it('turns the stored html into plain text for the textarea', () => {
    expect(plainTextFromHtml('<p>Line one<br>two &amp; three</p>')).toBe('Line one\ntwo & three')
  })
})
