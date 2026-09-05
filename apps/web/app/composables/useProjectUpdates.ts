import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProjectUpdateSchema, type ProjectUpdate, type ProjectUpdateBody } from '@nasq/contracts'
import { projectKeys } from './useProjects'

const ProjectUpdateListSchema = ProjectUpdateSchema.array()

export function useProjectUpdates(projectId: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.updates(projectId.value ?? 0)),
    enabled: computed(() => !!projectId.value),
    queryFn: () => $api(`/api/v1/projects/${projectId.value}/updates`, { schema: ProjectUpdateListSchema }),
  })
}

export function useCreateProjectUpdate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: ProjectUpdateBody }) =>
      $api(`/api/v1/projects/${projectId}/updates`, { method: 'POST', body, schema: ProjectUpdateSchema }),
    onSuccess: (update, { projectId }) => {
      const key = projectKeys.updates(projectId)
      const prev = qc.getQueryData<ProjectUpdate[]>(key)
      qc.setQueryData(key, prev ? [update, ...prev] : [update])
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}
