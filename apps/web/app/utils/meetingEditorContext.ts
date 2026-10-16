import type { LocationQuery } from 'vue-router'
import { recordSiblingTo } from './recordListOrigin'
import { parsePositiveId } from './routeParams'
import type { MeetingMinutesFormValue, MeetingMinutesRecommendation } from './meetingMinutesForm'

export function parseMeetingEditorContext(query: LocationQuery) {
  if (query.editor !== 'minutes') return null
  const key = typeof query.topic_key === 'string' ? query.topic_key.trim() : ''
  return { topicKey: key && key.length <= 200 ? key : null, newResolutionId: parsePositiveId(query.new_resolution_id) }
}

export function cleanMeetingEditorQuery(query: LocationQuery): LocationQuery {
  const { editor: _editor, topic_key: _topic, new_resolution_id: _recommendation, created_resolution_id: _created, ...rest } = query
  return rest
}

function editorSibling(path: string, query: LocationQuery, sourcePaths: readonly string[]) {
  const target = recordSiblingTo(path, cleanMeetingEditorQuery(query), sourcePaths)
  return { path, query: (typeof target === 'string' ? {} : target.query ?? {}) as LocationQuery }
}

export function meetingRecommendationCreateTo(meetingId: number, query: LocationQuery, sourcePaths: readonly string[], topicKey?: string) {
  const target = editorSibling(`/meetings/${meetingId}/resolutions/new`, query, sourcePaths)
  target.query = { ...target.query, tab: 'minutes', editor: 'minutes', ...(topicKey ? { topic_key: topicKey } : {}) }
  return target
}

export function meetingMinutesEditorTo(meetingId: number, query: LocationQuery, sourcePaths: readonly string[], newResolutionId?: number) {
  const target = editorSibling(`/meetings/${meetingId}/minutes`, query, sourcePaths)
  const context = parseMeetingEditorContext(query)
  target.query = { ...target.query, tab: 'minutes', editor: 'minutes', ...(context?.topicKey ? { topic_key: context.topicKey } : {}), ...(newResolutionId ? { new_resolution_id: String(newResolutionId) } : {}) }
  return target
}

export function attachNewMeetingRecommendation(form: MeetingMinutesFormValue, context: NonNullable<ReturnType<typeof parseMeetingEditorContext>>, recommendations: MeetingMinutesRecommendation[]) {
  const id = context.newResolutionId
  if (!id || !recommendations.some(item => item.id === id)) return { form, status: 'unavailable' as const }
  if (form.topics.some(topic => topic.resolution_ids.includes(id))) return { form, status: 'already_linked' as const }
  if (!context.topicKey || !form.topics.some(topic => topic.key === context.topicKey)) return { form, status: 'unassigned' as const }
  return { form: { ...form, topics: form.topics.map(topic => topic.key === context.topicKey ? { ...topic, resolution_ids: [...topic.resolution_ids, id] } : topic) }, status: 'linked' as const }
}
