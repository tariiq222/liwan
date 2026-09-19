import { describe, expect, it } from 'vitest'
import { mergeMeetingPeople } from '../meetingPeople'

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
})
