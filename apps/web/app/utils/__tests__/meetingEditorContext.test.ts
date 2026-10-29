import { describe, expect, it } from 'vitest'
import { createMeetingMinutesForm } from '../meetingMinutesForm'
import { attachNewMeetingRecommendation, cleanMeetingEditorQuery, meetingMinutesEditorTo, meetingRecommendationCreateTo, parseMeetingEditorContext } from '../meetingEditorContext'

describe('minutes and recommendation return context', () => {
  it('carries the filtered source through creation and returns to the same editor topic', () => {
    const create = meetingRecommendationCreateTo(7, { listOrigin: '/meetings/series/2?session_state=confirmed', tab: 'minutes' }, ['/meetings', '/meetings/series/2'], 'topic-a')
    expect(create).toEqual({ path: '/meetings/7/resolutions/new', query: { listOrigin: '/meetings/series/2?session_state=confirmed', tab: 'minutes', editor: 'minutes', topic_key: 'topic-a' } })
    expect(meetingMinutesEditorTo(7, create.query!, ['/meetings', '/meetings/series/2'], 12)).toEqual({ path: '/meetings/7/minutes', query: { listOrigin: '/meetings/series/2?session_state=confirmed', tab: 'minutes', editor: 'minutes', topic_key: 'topic-a', new_resolution_id: '12' } })
  })
  it('rejects foreign editor contexts and clears one-use fields on return to the record', () => {
    expect(parseMeetingEditorContext({ editor: 'https://other.test', topic_key: 'a' })).toBeNull()
    expect(parseMeetingEditorContext({ editor: 'minutes', topic_key: 'a', new_resolution_id: '-1' })).toEqual({ topicKey: 'a', newResolutionId: null })
    expect(cleanMeetingEditorQuery({ editor: 'minutes', topic_key: 'a', new_resolution_id: '12', listOrigin: '/meetings' })).toEqual({ listOrigin: '/meetings' })
  })
  it('only links a readable recommendation to its original topic without moving an existing assignment', () => {
    const form = createMeetingMinutesForm({ topics: [{ key: 'topic-a', title: 'A', discussion: '', project_id: null, resolution_ids: [] }, { key: 'topic-b', title: 'B', discussion: '', project_id: null, resolution_ids: [13] }] })
    const linked = attachNewMeetingRecommendation(form, { topicKey: 'topic-a', newResolutionId: 12 }, [{ id: 12, name: 'New' }, { id: 13, name: 'Existing' }])
    expect(linked.form.topics[0]!.resolution_ids).toEqual([12])
    expect(form.topics[0]!.resolution_ids).toEqual([])
    expect(linked.status).toBe('linked')
    expect(attachNewMeetingRecommendation(form, { topicKey: 'missing', newResolutionId: 12 }, [{ id: 12, name: 'New' }]).status).toBe('unassigned')
    expect(attachNewMeetingRecommendation(form, { topicKey: 'topic-a', newResolutionId: 99 }, []).status).toBe('unavailable')
    expect(attachNewMeetingRecommendation(form, { topicKey: 'topic-a', newResolutionId: 13 }, [{ id: 13, name: 'Existing' }]).form).toEqual(form)
    // A recommendation already linked to a topic says so, whatever topic key the return link carries.
    expect(attachNewMeetingRecommendation(form, { topicKey: 'topic-b', newResolutionId: 13 }, [{ id: 13, name: 'Existing' }]).status).toBe('already_linked')
    expect(attachNewMeetingRecommendation(form, { topicKey: null, newResolutionId: 13 }, [{ id: 13, name: 'Existing' }]).status).toBe('already_linked')
  })
})
