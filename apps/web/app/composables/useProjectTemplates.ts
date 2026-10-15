import { projectKeys } from '@/composables/projectKeys'
import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  ProjectTemplateApplyResponseSchema,
  ProjectTemplateListSchema,
  ProjectTemplateSchema,
  type ProjectTemplateApply,
  type ProjectTemplateCreate,
  type ProjectTemplatePatch,
} from '@nasq/contracts'

export const projectTemplateKeys = {
  all: ['project-templates'] as const,
  list: (params: Record<string, unknown>) => ['project-templates', 'list', params] as const,
  detail: (id: number) => ['project-templates', 'detail', id] as const,
}

export type ProjectTemplateListParams = { q?: string; limit?: number; offset?: number }

export function useProjectTemplateList(params: MaybeRefOrGetter<ProjectTemplateListParams> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectTemplateKeys.list({ ...(toValue(params) as ProjectTemplateListParams) })),
    queryFn: () => {
      const query = toValue(params)
      return $api('/api/v1/project-templates', {
        query: { q: query.q?.trim() || undefined, limit: query.limit ?? 50, offset: query.offset ?? 0 },
        schema: ProjectTemplateListSchema,
      })
    },
  })
}

export function useProjectTemplate(id: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectTemplateKeys.detail(id.value ?? 0)),
    enabled: computed(() => !!id.value),
    queryFn: () => $api(`/api/v1/project-templates/${id.value}`, { schema: ProjectTemplateSchema }),
  })
}

function invalidateTemplates(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: projectTemplateKeys.all })
}

export function useCreateProjectTemplate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: ProjectTemplateCreate) => $api('/api/v1/project-templates', { method: 'POST', body, schema: ProjectTemplateSchema }),
    onSuccess: (item) => { qc.setQueryData(projectTemplateKeys.detail(item.id), item); return invalidateTemplates(qc) },
  })
}

export function useUpdateProjectTemplate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ProjectTemplatePatch }) => $api(`/api/v1/project-templates/${id}`, { method: 'PATCH', body: patch, schema: ProjectTemplateSchema }),
    onSuccess: (item) => { qc.setQueryData(projectTemplateKeys.detail(item.id), item); return invalidateTemplates(qc) },
  })
}

export function useDeleteProjectTemplate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) => $api(`/api/v1/project-templates/${id}`, { method: 'DELETE' }),
    onSuccess: (_item, id) => { qc.removeQueries({ queryKey: projectTemplateKeys.detail(id) }); return invalidateTemplates(qc) },
  })
}

export function useApplyProjectTemplate() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ProjectTemplateApply }) => $api(`/api/v1/project-templates/${id}/apply`, { method: 'POST', body, schema: ProjectTemplateApplyResponseSchema }),
    onSuccess: (project) => {
      qc.setQueryData(projectKeys.detail(project.id), project)
      return qc.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}


export function useProjectTemplateNavigation() {
  const route = useRoute()
  // Every template record and form hangs off the one list, so the return trip is
  // literal and carries only the state that list was showing. A referrer's
  // returnTo is dropped rather than forwarded: on the list URL it would nest one
  // level deeper on every round trip and redirect that page's own controls.
  const listQuery = computed(() => {
    const { returnTo: _referrer, ...rest } = route.query
    return rest
  })
  const backTo = computed(() => ({ path: '/projects/templates', query: listQuery.value }))
  // Drilling in keeps the same list state on the URL, so returning restores it.
  const templatePath = (id?: number | null, action?: 'edit' | 'apply' | 'new') => ({
    path: action === 'new' ? '/projects/templates/new' : `/projects/templates/${id}${action ? `/${action}` : ''}`,
    query: listQuery.value,
  })
  return { backTo, templatePath }
}
