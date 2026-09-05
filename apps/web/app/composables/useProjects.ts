import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProjectDetailSchema, ProjectListSchema, ProjectRefSchema, type ProjectDetail, type ProjectPatch, type ProjectStatus } from '@nasq/contracts'

export const projectKeys = {
  all: ['projects'] as const,
  list: ['projects', 'list'] as const,
  minimal: ['projects', 'minimal'] as const,
  detail: (id: number) => ['project', id] as const,
  stages: (id: number) => ['project', id, 'stages'] as const,
  followers: (id: number) => ['project', id, 'followers'] as const,
  milestones: (id: number) => ['project', id, 'milestones'] as const,
  updates: (id: number) => ['project', id, 'updates'] as const,
}

const ProjectRefListSchema = ProjectRefSchema.array()

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
export function useProjectList(archived: Ref<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...projectKeys.list, archived.value] as const),
    queryFn: () => $api('/api/v1/projects', { query: { archived: archived.value ? 1 : undefined }, schema: ProjectListSchema }),
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

export function useCreateProject() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: { name: string }) => $api('/api/v1/projects', { method: 'POST', body, schema: ProjectDetailSchema }),
    onSuccess: (detail) => {
      qc.setQueryData(projectKeys.detail(detail.id), detail)
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ProjectPatch }) =>
      $api(`/api/v1/projects/${id}`, { method: 'PATCH', body: patch, schema: ProjectDetailSchema }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: projectKeys.detail(id) })
      const prev = qc.getQueryData<ProjectDetail>(projectKeys.detail(id))
      if (prev) {
        qc.setQueryData(projectKeys.detail(id), {
          ...prev,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description_html: patch.description } : {}),
        })
      }
      return { prev }
    },
    onError: (_e, { id }, ctx) => {
      if (ctx?.prev) qc.setQueryData(projectKeys.detail(id), ctx.prev)
    },
    onSuccess: (detail, { id }) => {
      qc.setQueryData(projectKeys.detail(id), detail)
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

function useProjectAction(path: 'archive' | 'unarchive') {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id }: { id: number }) => $api(`/api/v1/projects/${id}/${path}`, { method: 'POST', body: {}, schema: ProjectDetailSchema }),
    onSuccess: (detail, { id }) => {
      qc.setQueryData(projectKeys.detail(id), detail)
      qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export const useArchiveProject = () => useProjectAction('archive')
export const useUnarchiveProject = () => useProjectAction('unarchive')

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
