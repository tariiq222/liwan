import { describe, expect, it } from 'vitest'
import {
  createMeetingMinutesForm,
  newMeetingMinutesTopic,
  plainTextFromHtml,
  selectMeetingMinutesSource,
  validateMeetingMinutesForm,
} from '../meetingMinutesForm'

describe('meeting minutes form helpers', () => {
  it('creates stable topic keys and clones assigned recommendation ids', () => {
    const topic = newMeetingMinutesTopic()
    const form = createMeetingMinutesForm({ topics: [{ ...topic, resolution_ids: [4, 4] }] })
    expect(form.topics[0]?.key).toBe(topic.key)
    expect(form.topics[0]?.resolution_ids).toEqual([4])
  })

  it('converts legacy agenda markup into plain text', () => {
    expect(plainTextFromHtml('<p>Opening</p><p>Second&nbsp;&amp; item</p>')).toBe('Opening\nSecond & item')
  })

  it('rejects duplicate recommendation assignment across topics', () => {
    const form = createMeetingMinutesForm({
      topics: [
        { ...newMeetingMinutesTopic(), resolution_ids: [1] },
        { ...newMeetingMinutesTopic(), resolution_ids: [1] },
      ],
    })
    expect(validateMeetingMinutesForm(form)).toContain('duplicate_recommendation')
  })

  it('allows different recommendation ids with the same title', () => {
    const form = createMeetingMinutesForm({ topics: [{ ...newMeetingMinutesTopic(), resolution_ids: [1, 2] }] })
    expect(validateMeetingMinutesForm(form, [{ id: 1, name: 'Same' }, { id: 2, name: 'same' }])).not.toContain('duplicate_recommendation_text')
  })

  it('uses the finalized snapshot for a done meeting and never falls back from an old version', () => {
    const finalized = { minutes_form: createMeetingMinutesForm({ opening: 'final' }), agenda: '<p>final agenda</p>', minutes: '<p>final minutes</p>', resolutions: [] }
    const meeting = { state: 'done', minutes_form: createMeetingMinutesForm({ opening: 'current' }), minutes_snapshot: finalized }
    expect(selectMeetingMinutesSource(meeting).form?.opening).toBe('final')
    const oldVersion = selectMeetingMinutesSource(meeting, { agenda: '<p>old</p>', minutes: '<p>old</p>', resolutions: [{ id: 9, name: 'Old recommendation' }] })
    expect(oldVersion.form).toBeNull()
    expect(oldVersion.agenda).toBe('<p>old</p>')
    expect(oldVersion.resolutions).toEqual([{ id: 9, name: 'Old recommendation' }])
    const missingSnapshot = selectMeetingMinutesSource({ state: 'done', minutes_form: createMeetingMinutesForm({ opening: 'current' }) })
    expect(missingSnapshot.form).toBeNull()
    expect(missingSnapshot.resolutions).toEqual([])
  })
})
