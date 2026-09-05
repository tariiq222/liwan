import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { ProjectStageSchema, type ProjectStage } from '@nasq/contracts'
import { projectKeys } from './useProjects'

const ProjectStageListSchema = ProjectStageSchema.array()

// Stages live on the project detail (ProjectDetail.stages), not their own
// query key: every mutation here invalidates projectKeys.detail(projectId)
// to refresh them, rather than maintaining a separate cache entry.
export function useAddStage() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, name, fold }: { projectId: number; name: string; fold?: boolean }) =>
      $api(`/api/v1/projects/${projectId}/stages`, { method: 'POST', body: { name, fold }, schema: ProjectStageSchema }),
    onSuccess: (_stage, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useUpdateStage() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id, patch }: { projectId: number; id: number; patch: { name?: string; fold?: boolean } }) =>
      $api(`/api/v1/projects/${projectId}/stages/${id}`, { method: 'PATCH', body: patch, schema: ProjectStageSchema }),
    onSuccess: (_stage, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useReorderStages() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, ids }: { projectId: number; ids: number[] }) =>
      $api(`/api/v1/projects/${projectId}/stages/order`, { method: 'PUT', body: { ids }, schema: ProjectStageListSchema }),
    onSuccess: (_stages: ProjectStage[], { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useDeleteStage() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id }: { projectId: number; id: number }) => $api(`/api/v1/projects/${projectId}/stages/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, { projectId }) => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}
