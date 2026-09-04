import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProjectDetailSchema, ProjectRefSchema, ProjectSchema, type ProjectDetail, type ProjectStatus } from '@nasq/contracts'

export const projectKeys = {
  all: ['projects'] as const,
  list: ['projects', 'list'] as const,
  minimal: ['projects', 'minimal'] as const,
  detail: (id: number) => ['project', id] as const,
}

const ProjectRefListSchema = ProjectRefSchema.array()
const ProjectListSchema = ProjectSchema.array()

// Minimal {id, name} refs for pickers (create-task dialog, مهامي project filter, ⌘K).
export function useProjects() {
  const { $api } = useApi()
  return useQuery({
    queryKey: projectKeys.minimal,
    queryFn: () => $api('/api/v1/projects', { query: { minimal: 1 }, schema: ProjectRefListSchema }),
    staleTime: 5 * 60 * 1000,
  })
}

// The projects table: status + progress per project.
export function useProjectList() {
  const { $api } = useApi()
  return useQuery({
    queryKey: projectKeys.list,
    queryFn: () => $api('/api/v1/projects', { schema: ProjectListSchema }),
  })
}

export function useProject(id: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.detail(id.value ?? 0)),
    enabled: computed(() => !!id.value),
    queryFn: () => $api(`/api/v1/projects/${id.value}`, { schema: ProjectDetailSchema }),
  })
}

// Non-optimistic on purpose (same rule as task transitions): the server may
// refuse (403 status_forbidden), so the control shows a pending state and the
// cache is replaced with whatever the server returns.
export function useSetProjectStatus() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: ProjectStatus }) =>
      $api(`/api/v1/projects/${id}/status`, { method: 'POST', body: { status }, schema: ProjectDetailSchema }),
    onSuccess: (detail: ProjectDetail, { id }) => {
      qc.setQueryData(projectKeys.detail(id), detail)
      qc.invalidateQueries({ queryKey: projectKeys.list })
    },
  })
}
