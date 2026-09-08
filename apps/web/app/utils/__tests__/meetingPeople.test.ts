import { describe, expect, it } from 'vitest'
import { mergeMeetingPeople, splitMeetingPeople } from '../meetingPeople'

describe('meeting people options', () => {
  it('keeps selected attendee and secretary labels when a new search replaces results', () => {
    expect(mergeMeetingPeople({
      selectedIds: [9],
      secretaryId: 9,
      known: [{ id: 9, name: 'Amina' }],
      results: [{ id: 11, name: 'Omar' }],
    })).toEqual([
      { id: 9, name: 'Amina' },
      { id: 11, name: 'Omar' },
    ])
  })

  it('keeps selected people in a separate stable list and bounds search results', () => {
    expect(splitMeetingPeople({
      selectedIds: [9], secretaryId: 9,
      known: [{ id: 9, name: 'Amina' }],
      results: [{ id: 9, name: 'Amina' }, { id: 11, name: 'Omar' }, { id: 12, name: 'Lina' }],
      limit: 1,
    })).toEqual({
      selected: [{ id: 9, name: 'Amina' }],
      results: [{ id: 11, name: 'Omar' }],
      secretary: [{ id: 9, name: 'Amina' }, { id: 11, name: 'Omar' }],
    })
  })
})
