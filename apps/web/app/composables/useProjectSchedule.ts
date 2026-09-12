import { taskKeys } from './useTasks'
import { projectKeys } from './projectKeys'
import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProjectScheduleSchema, ScheduleTaskSchema, type ProjectSchedule, type ScheduleTaskPatch } from '@nasq/contracts'

export const scheduleKeys = {
  detail: (id: number) => [...projectKeys.detail(id), 'schedule'] as const,
}

export function useProjectSchedule(projectId: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => scheduleKeys.detail(projectId.value ?? 0)),
    enabled: computed(() => !!projectId.value),
    queryFn: () => $api(`/api/v1/projects/${projectId.value}/schedule`, { schema: ProjectScheduleSchema }),
  })
}

export function useUpdateProjectScheduleTask() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, taskId, patch }: { projectId: number; taskId: number; patch: ScheduleTaskPatch }) =>
      $api(`/api/v1/projects/${projectId}/schedule/tasks/${taskId}`, { method: 'PATCH', body: patch, schema: ScheduleTaskSchema }),
    onSuccess: async (_task, { projectId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: scheduleKeys.detail(projectId) }),
        qc.invalidateQueries({ queryKey: taskKeys.all }),
      ])
    },
  })
}

export type { ProjectSchedule }
