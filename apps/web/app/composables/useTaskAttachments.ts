import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  TaskAttachmentListSchema,
  TaskAttachmentSchema,
  type TaskAttachment,
  type TaskAttachmentList,
} from '@liwan/contracts'
import { taskKeys } from './useTasks'

export type { TaskAttachment, TaskAttachmentList }

export const taskAttachmentKeys = {
  list: (taskId: number) => ['tasks', 'attachments', taskId] as const,
}

export function useTaskAttachments(taskId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => taskAttachmentKeys.list(toValue(taskId) ?? 0)),
    enabled: computed(() => !!toValue(taskId)),
    queryFn: () => $api(`/api/v1/tasks/${toValue(taskId)}/attachments`, { schema: TaskAttachmentListSchema }),
  })
}

export function useUploadTaskAttachment() {
  const queryClient = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ taskId, name, mimetype, data }: {
      taskId: number
      name: string
      mimetype?: string
      data: string
    }) => $api(`/api/v1/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: { name, mimetype, data },
      schema: TaskAttachmentSchema,
    }),
    onSuccess: (_attachment, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskAttachmentKeys.list(taskId) })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
    },
  })
}

export function useDeleteTaskAttachment() {
  const queryClient = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ taskId, attachmentId }: { taskId: number; attachmentId: number }) =>
      $api(`/api/v1/tasks/${taskId}/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: (_result, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskAttachmentKeys.list(taskId) })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
    },
  })
}

