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

export function useMeetings(params: MaybeRefOrGetter<{ q?: string; limit?: number; offset?: number }>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => ['meetings', toValue(params)]),
    queryFn: () => {
      const p = toValue(params)
      return $api('/api/v1/meetings', {
        query: {
          q: p.q || undefined,
          limit: Math.min(Math.max(p.limit ?? 200, 1), 200),
          offset: Math.max(p.offset ?? 0, 0),
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
