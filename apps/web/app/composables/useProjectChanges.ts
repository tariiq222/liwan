import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  ChangeCategoryListSchema, ChangeCategorySchema, ProjectChangeListSchema, ProjectChangeSchema,
  type ChangeCategoryWrite, type ProjectChange, type ProjectChangeWrite,
} from '@liwan/contracts'
import { changeKeys, type ChangeListFilters } from './projectChangeKeys'

export type ChangeAction = 'submit' | 'withdraw' | 'approve' | 'reject' | 'implement'

function invalidate(qc: ReturnType<typeof useQueryClient>, projectId: number) {
  return qc.invalidateQueries({ queryKey: changeKeys.all(projectId) })
}

export function useProjectChanges(projectId: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<ChangeListFilters> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => changeKeys.list(toValue(projectId) ?? 0, toValue(params))),
    enabled: computed(() => !!toValue(projectId)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/changes`, { query: toValue(params), schema: ProjectChangeListSchema }),
  })
}

export function useProjectChange(projectId: MaybeRefOrGetter<number | null>, id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => changeKeys.item(toValue(projectId) ?? 0, toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(projectId) && !!toValue(id)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/changes/${toValue(id)}`, { schema: ProjectChangeSchema }),
  })
}

// Every write answers with the request as the server now holds it, so the detail cache takes it as is.
function writeItem(qc: ReturnType<typeof useQueryClient>, projectId: number, item: ProjectChange) {
  qc.setQueryData(changeKeys.item(projectId, item.id), item)
  return invalidate(qc, projectId)
}

export function useCreateProjectChange() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: ProjectChangeWrite }) => $api(`/api/v1/projects/${projectId}/changes`, { method: 'POST', body, schema: ProjectChangeSchema }),
    onSuccess: (item, { projectId }) => writeItem(qc, projectId, item),
  })
}

export function useUpdateProjectChange() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id, expected, body }: { projectId: number; id: number; expected: string; body: ProjectChangeWrite }) =>
      $api(`/api/v1/projects/${projectId}/changes/${id}`, { method: 'PATCH', body: { ...body, expected_updated_at: expected }, schema: ProjectChangeSchema }),
    onSuccess: (item, { projectId }) => writeItem(qc, projectId, item),
  })
}

export function useProjectChangeAction() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id, action, expected, note }: { projectId: number; id: number; action: ChangeAction; expected: string; note?: string }) =>
      $api(`/api/v1/projects/${projectId}/changes/${id}/${action}`, {
        method: 'POST', body: { expected_updated_at: expected, ...(note && (action === 'approve' || action === 'reject') ? { note } : {}) }, schema: ProjectChangeSchema,
      }),
    onSuccess: (item, { projectId }) => writeItem(qc, projectId, item),
  })
}

/** The company's change categories; a settings manager may also ask for the archived ones. */
export function useChangeCategories(archived: MaybeRefOrGetter<boolean> = false) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...changeKeys.categories, toValue(archived) ? 'all' : 'active']),
    queryFn: () => $api('/api/v1/pmo/change-categories', { query: { active: toValue(archived) ? 'all' : '1' }, schema: ChangeCategoryListSchema }),
  })
}

export function useCreateChangeCategory() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: (body: ChangeCategoryWrite) => $api('/api/v1/pmo/change-categories', { method: 'POST', body, schema: ChangeCategorySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: changeKeys.categories }),
  })
}

export function useUpdateChangeCategory() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ChangeCategoryWrite }) => $api(`/api/v1/pmo/change-categories/${id}`, { method: 'PATCH', body, schema: ChangeCategorySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: changeKeys.categories }),
  })
}
