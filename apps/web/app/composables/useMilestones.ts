import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { MilestoneSchema, type MilestonePatch } from '@nasq/contracts'
import { projectKeys } from './useProjects'

const MilestoneListSchema = MilestoneSchema.array()

export function useMilestones(projectId: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.milestones(projectId.value ?? 0)),
    enabled: computed(() => !!projectId.value),
    queryFn: () => $api(`/api/v1/projects/${projectId.value}/milestones`, { schema: MilestoneListSchema }),
  })
}

export function useCreateMilestone() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, name, deadline }: { projectId: number; name: string; deadline?: string | null }) =>
      $api(`/api/v1/projects/${projectId}/milestones`, { method: 'POST', body: { name, deadline }, schema: MilestoneSchema }),
    onSuccess: (_milestone, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.milestones(projectId) })
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useUpdateMilestone() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id, patch }: { projectId: number; id: number; patch: MilestonePatch }) =>
      $api(`/api/v1/projects/${projectId}/milestones/${id}`, { method: 'PATCH', body: patch, schema: MilestoneSchema }),
    onSuccess: (_milestone, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.milestones(projectId) })
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useDeleteMilestone() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id }: { projectId: number; id: number }) =>
      $api(`/api/v1/projects/${projectId}/milestones/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.milestones(projectId) })
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}
