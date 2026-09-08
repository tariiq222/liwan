import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { z } from 'zod'
import {
  MeetingCreateSchema,
  MeetingDetailSchema,
  MeetingListSchema,
  MeetingPatchSchema,
  MeetingResolutionCreateSchema,
  MeetingResolutionSchema,
  TaskAttachmentListSchema,
  TaskAttachmentSchema,
  type MeetingCreate,
  type MeetingPatch,
  type MeetingResolutionCreate,
} from '@nasq/contracts'

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
}>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['meetings', toValue(params)]),
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
}

export function useMeeting(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['meetings', toValue(id)]),
    enabled: computed(() => Number.isInteger(toValue(id))),
    queryFn: () => $api(`/api/v1/meetings/${toValue(id)}`, { schema: MeetingDetailSchema }),
  })
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
  })
}

export function useMeetingAttachments(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['meetings', 'attachments', toValue(id)]),
    enabled: computed(() => Number.isInteger(toValue(id))),
    queryFn: () => $api(`/api/v1/meetings/${toValue(id)}/attachments`, { schema: TaskAttachmentListSchema }),
  })
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
    onSuccess: (_row, { meetingId }) => qc.invalidateQueries({ queryKey: ['meetings', 'attachments', meetingId] }),
  })
}

export function useDeleteMeetingAttachment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ meetingId, attachmentId }: { meetingId: number; attachmentId: number }) =>
      $api(`/api/v1/meetings/${meetingId}/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: (_row, { meetingId }) => qc.invalidateQueries({ queryKey: ['meetings', 'attachments', meetingId] }),
  })
}
