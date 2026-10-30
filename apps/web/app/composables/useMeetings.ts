import type { MaybeRefOrGetter } from 'vue'
import { computed, onServerPrefetch, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { z } from 'zod'
import {
  MeetingCreateSchema,
  MeetingDetailSchema,
  MeetingListSchema,
  MeetingOccurrenceCreateSchema,
  MeetingPatchSchema,
  MeetingResolutionCreateSchema,
  MeetingResolutionSchema,
  MeetingSeriesCreateSchema,
  MeetingSeriesDetailSchema,
  MeetingSeriesListSchema,
  TaskAttachmentListSchema,
  TaskAttachmentSchema,
  type MeetingCreate,
  type MeetingOccurrenceCreate,
  type MeetingPatch,
  type MeetingResolutionCreate,
  type MeetingSeriesCreate,
} from '@liwan/contracts'
import { invalidateMeetingCaches, meetingKeys, meetingSeriesKeys } from './meetingKeys'

function prefetchMeetingQuery(query: { suspense: () => Promise<unknown> }, enabled: MaybeRefOrGetter<boolean> = true) {
  onServerPrefetch(async () => {
    if (!toValue(enabled)) return
    try {
      await query.suspense()
    } catch {
      // Vue Query keeps the failure on the query for SharedPageState to render.
    }
  })
}

export function useMeetings(params: MaybeRefOrGetter<{
  q?: string
  limit?: number
  offset?: number
  date_from?: string
  date_to?: string
  state?: string
  organizer_id?: number
  project_id?: number
  series_id?: number
  mine?: boolean
}>, options: { enabled?: MaybeRefOrGetter<boolean> } = {}) {
  const { $api } = useApi()
  const query = useQuery({
    queryKey: computed(() => meetingKeys.list(toValue(params))),
    enabled: computed(() => toValue(options.enabled) ?? true),
    queryFn: () => {
      const p = toValue(params)
      const ranged = Boolean(p.date_from && p.date_to)
      const cap = ranged ? 2000 : 200
      return $api('/api/v1/meetings', {
        query: {
          q: p.q || undefined,
          limit: Math.min(Math.max(p.limit ?? cap, 1), cap),
          offset: Math.max(p.offset ?? 0, 0),
          date_from: p.date_from,
          date_to: p.date_to,
          state: p.state,
          organizer_id: p.organizer_id,
          project_id: p.project_id,
          series_id: p.series_id,
          mine: p.mine ? 1 : undefined,
        },
        schema: MeetingListSchema,
      })
    },
  })
  prefetchMeetingQuery(query, options.enabled ?? true)
  return query
}

export function useMeeting(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const enabled = computed(() => Number.isInteger(toValue(id)))
  const query = useQuery({
    queryKey: computed(() => meetingKeys.detail(toValue(id))),
    enabled,
    queryFn: () => $api(`/api/v1/meetings/${toValue(id)}`, { schema: MeetingDetailSchema }),
  })
  prefetchMeetingQuery(query, enabled)
  return query
}

export function useCreateMeeting() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: MeetingCreate) => $api('/api/v1/meetings', {
      method: 'POST',
      body: MeetingCreateSchema.parse(body),
      schema: MeetingDetailSchema,
    }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function usePatchMeeting() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: MeetingPatch }) => $api(`/api/v1/meetings/${id}`, {
      method: 'PATCH',
      body: MeetingPatchSchema.parse(body),
      schema: MeetingDetailSchema,
    }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function useCreateResolution() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ meetingId, body }: { meetingId: number; body: MeetingResolutionCreate }) =>
      $api(`/api/v1/meetings/${meetingId}/resolutions`, {
        method: 'POST',
        body: MeetingResolutionCreateSchema.parse(body),
        schema: MeetingResolutionSchema,
      }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function useConvertResolution() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ meetingId, resolutionId, projectId }: { meetingId: number; resolutionId: number; projectId: number }) =>
      $api(`/api/v1/meetings/${meetingId}/resolutions/${resolutionId}/convert`, {
        method: 'POST',
        body: { project_id: projectId },
        schema: z.object({ id: z.number(), name: z.string() }).strict(),
      }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function useMeetingAttachments(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const enabled = computed(() => Number.isInteger(toValue(id)))
  const query = useQuery({
    queryKey: computed(() => meetingKeys.attachments(toValue(id))),
    enabled,
    queryFn: () => $api(`/api/v1/meetings/${toValue(id)}/attachments`, { schema: TaskAttachmentListSchema }),
  })
  prefetchMeetingQuery(query, enabled)
  return query
}

export function useUploadMeetingAttachment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ meetingId, name, mimetype, data }: { meetingId: number; name: string; mimetype?: string; data: string }) =>
      $api(`/api/v1/meetings/${meetingId}/attachments`, {
        method: 'POST',
        body: { name, mimetype, data },
        schema: TaskAttachmentSchema,
      }),
    onSuccess: (_row, { meetingId }) => Promise.all([
      invalidateMeetingCaches(qc),
      qc.invalidateQueries({ queryKey: meetingKeys.attachments(meetingId) }),
    ]),
  })
}

export function useDeleteMeetingAttachment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ meetingId, attachmentId }: { meetingId: number; attachmentId: number }) =>
      $api(`/api/v1/meetings/${meetingId}/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: (_row, { meetingId }) => Promise.all([
      invalidateMeetingCaches(qc),
      qc.invalidateQueries({ queryKey: meetingKeys.attachments(meetingId) }),
    ]),
  })
}

export function useMeetingAction() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: 'confirm' | 'complete' | 'reopen' | 'cancel'; body?: Record<string, unknown> }) =>
      $api(`/api/v1/meetings/${id}/${action}`, { method: 'POST', body, schema: MeetingDetailSchema }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

/** Delete a draft meeting; the server refuses every other state with a 409 (a confirmed meeting is cancelled). */
export function useDeleteMeeting() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/meetings/${id}`, { method: 'DELETE' }),
    onSuccess: (_row, id) => {
      qc.removeQueries({ queryKey: meetingKeys.detail(id) })
      return invalidateMeetingCaches(qc)
    },
  })
}

export function usePatchResolution() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ meetingId, resolutionId, body }: { meetingId: number; resolutionId: number; body: Record<string, unknown> }) =>
      $api(`/api/v1/meetings/${meetingId}/resolutions/${resolutionId}`, {
        method: 'PATCH',
        body,
        schema: MeetingResolutionSchema,
      }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function useResolutionAction() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ meetingId, resolutionId, action }: { meetingId: number; resolutionId: number; action: 'start' | 'complete' | 'cancel' | 'reopen' }) =>
      $api(`/api/v1/meetings/${meetingId}/resolutions/${resolutionId}/${action}`, {
        method: 'POST',
        schema: MeetingResolutionSchema,
      }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function useMeetingSeriesList(params: MaybeRefOrGetter<{ q?: string; project_id?: number; limit?: number; offset?: number }>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const query = useQuery({
    queryKey: computed(() => meetingSeriesKeys.list(toValue(params))),
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/meeting-series', {
      query: toValue(params),
      schema: MeetingSeriesListSchema,
    }),
  })
  prefetchMeetingQuery(query, enabled)
  return query
}

export function useMeetingSeries(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const enabled = computed(() => Number.isInteger(toValue(id)))
  const query = useQuery({
    queryKey: computed(() => meetingSeriesKeys.detail(toValue(id))),
    enabled,
    queryFn: () => $api(`/api/v1/meeting-series/${toValue(id)}`, { schema: MeetingSeriesDetailSchema }),
  })
  prefetchMeetingQuery(query, enabled)
  return query
}

export function useCreateMeetingSeries() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: MeetingSeriesCreate) => $api('/api/v1/meeting-series', {
      method: 'POST',
      body: MeetingSeriesCreateSchema.parse(body),
      schema: MeetingSeriesDetailSchema,
    }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function useCancelMeetingSeries() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (seriesId: number) => $api(`/api/v1/meeting-series/${seriesId}/cancel`, {
      method: 'POST',
      schema: MeetingSeriesDetailSchema,
    }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}

export function useAddSeriesOccurrence() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ seriesId, body }: { seriesId: number; body: MeetingOccurrenceCreate }) => $api(`/api/v1/meeting-series/${seriesId}/occurrences`, {
      method: 'POST',
      body: MeetingOccurrenceCreateSchema.parse(body),
      schema: MeetingDetailSchema,
    }),
    onSuccess: () => invalidateMeetingCaches(qc),
  })
}
