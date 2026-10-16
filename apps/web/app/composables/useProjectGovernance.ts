import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  TaskListSchema, ProjectRaciListSchema, ProjectRaciSchema, ProjectRegisterListSchema, ProjectRegisterSchema,
  ProjectStakeholderListSchema, ProjectStakeholderSchema,
  type ProjectRaci, type ProjectRaciWrite, type ProjectRegisterWrite, type ProjectStakeholderWrite,
} from '@webvue/contracts'

import { governanceKeys as projectGovernanceKeys, type GovernanceRegisterFilters } from './projectGovernanceKeys'
export { projectGovernanceKeys }

function invalidate(qc: ReturnType<typeof useQueryClient>, projectId: number) {
  return qc.invalidateQueries({ queryKey: projectGovernanceKeys.all(projectId) })
}

export function useProjectStakeholders(projectId: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<{ q?: string; limit?: number; offset?: number }> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectGovernanceKeys.stakeholders(toValue(projectId) ?? 0, toValue(params))),
    enabled: computed(() => !!toValue(projectId)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/stakeholders`, { query: toValue(params), schema: ProjectStakeholderListSchema }),
  })
}

export function useProjectStakeholder(projectId: MaybeRefOrGetter<number | null>, id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectGovernanceKeys.stakeholder(toValue(projectId) ?? 0, toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(projectId) && !!toValue(id)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/stakeholders/${toValue(id)}`, { schema: ProjectStakeholderSchema }),
  })
}

export function useProjectRaci(projectId: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<{ task_ids?: string; stakeholder_ids?: string }> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectGovernanceKeys.raci(toValue(projectId) ?? 0, toValue(params))),
    enabled: computed(() => !!toValue(projectId)),
    queryFn: async ({ signal }) => {
      const query = toValue(params)
      const items = [] as import('@webvue/contracts').ProjectRaci[]
      let total = 0; let can_manage = false
      do {
        signal.throwIfAborted()
        const page = await $api(`/api/v1/projects/${toValue(projectId)}/raci`, { query: { ...query, limit: 200, offset: items.length }, schema: ProjectRaciListSchema })
        total = page.total; can_manage = page.can_manage; items.push(...page.items)
        if (!page.items.length) break
      } while (items.length < total)
      return { items, total, can_manage }
    },
  })
}

export function useProjectRegister(projectId: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<GovernanceRegisterFilters> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectGovernanceKeys.register(toValue(projectId) ?? 0, toValue(params))),
    enabled: computed(() => !!toValue(projectId)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/register`, { query: toValue(params), schema: ProjectRegisterListSchema }),
  })
}

export function useProjectRegisterItem(projectId: MaybeRefOrGetter<number | null>, id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectGovernanceKeys.registerItem(toValue(projectId) ?? 0, toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(projectId) && !!toValue(id)),
    queryFn: () => $api(`/api/v1/projects/${toValue(projectId)}/register/${toValue(id)}`, { schema: ProjectRegisterSchema }),
  })
}

export function useCreateProjectStakeholder() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: ProjectStakeholderWrite }) => $api(`/api/v1/projects/${projectId}/stakeholders`, { method: 'POST', body, schema: ProjectStakeholderSchema }),
    onSuccess: (item, { projectId }) => { qc.setQueryData(projectGovernanceKeys.stakeholder(projectId, item.id), item); return invalidate(qc, projectId) },
  })
}

export function useUpdateProjectStakeholder() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, id, body }: { projectId: number; id: number; body: ProjectStakeholderWrite }) => $api(`/api/v1/projects/${projectId}/stakeholders/${id}`, { method: 'PATCH', body, schema: ProjectStakeholderSchema }),
    onSuccess: (item, { projectId }) => { qc.setQueryData(projectGovernanceKeys.stakeholder(projectId, item.id), item); return invalidate(qc, projectId) },
  })
}

export function useDeleteProjectStakeholder() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({ mutationFn: ({ projectId, id }: { projectId: number; id: number }) => $api(`/api/v1/projects/${projectId}/stakeholders/${id}`, { method: 'DELETE' }), onSuccess: (_, { projectId, id }) => { qc.removeQueries({ queryKey: projectGovernanceKeys.stakeholder(projectId, id), exact: true }); return invalidate(qc, projectId) } })
}

function reconcileRaci(qc: ReturnType<typeof useQueryClient>, projectId: number, item: ProjectRaci | null, deletedId?: number) {
  const entries = qc.getQueriesData<{ items: ProjectRaci[]; total: number; can_manage: boolean }>({ queryKey: [...projectGovernanceKeys.all(projectId), 'raci'] })
  for (const [key, data] of entries) {
    if (!data) continue
    const params = key[4] as { task_ids?: string; stakeholder_ids?: string } | undefined
    const contains = (ids: string | undefined, id: number) => ids === undefined || ids.split(',').includes(String(id))
    const existing = data.items.find(row => row.id === (item?.id ?? deletedId))
    const filtered = data.items.filter(row => row.id !== (item?.id ?? deletedId))
    const matches = item && contains(params?.task_ids, item.task.id) && contains(params?.stakeholder_ids, item.stakeholder.id)
    qc.setQueryData(key, { ...data, items: matches ? [...filtered, item] : filtered, total: data.total - (existing ? 1 : 0) + (matches ? 1 : 0) })
  }
  return invalidate(qc, projectId)
}

export function useCreateProjectRaci() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({ mutationFn: ({ projectId, body }: { projectId: number; body: ProjectRaciWrite }) => $api(`/api/v1/projects/${projectId}/raci`, { method: 'POST', body, schema: ProjectRaciSchema }), onSuccess: (item, { projectId }) => reconcileRaci(qc, projectId, item) })
}
export function useUpdateProjectRaci() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({ mutationFn: ({ projectId, id, body }: { projectId: number; id: number; body: ProjectRaciWrite }) => $api(`/api/v1/projects/${projectId}/raci/${id}`, { method: 'PATCH', body, schema: ProjectRaciSchema }), onSuccess: (item, { projectId }) => reconcileRaci(qc, projectId, item) })
}
export function useDeleteProjectRaci() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({ mutationFn: ({ projectId, id }: { projectId: number; id: number }) => $api(`/api/v1/projects/${projectId}/raci/${id}`, { method: 'DELETE' }), onSuccess: (_, { projectId, id }) => reconcileRaci(qc, projectId, null, id) })
}

export function useCreateProjectRegister() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({ mutationFn: ({ projectId, body }: { projectId: number; body: ProjectRegisterWrite }) => $api(`/api/v1/projects/${projectId}/register`, { method: 'POST', body, schema: ProjectRegisterSchema }), onSuccess: (item, { projectId }) => { qc.setQueryData(projectGovernanceKeys.registerItem(projectId, item.id), item); return invalidate(qc, projectId) } })
}
export function useUpdateProjectRegister() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({ mutationFn: ({ projectId, id, body }: { projectId: number; id: number; body: ProjectRegisterWrite }) => $api(`/api/v1/projects/${projectId}/register/${id}`, { method: 'PATCH', body, schema: ProjectRegisterSchema }), onSuccess: (item, { projectId }) => { qc.setQueryData(projectGovernanceKeys.registerItem(projectId, item.id), item); return invalidate(qc, projectId) } })
}
export function useDeleteProjectRegister() {
  const qc = useQueryClient(); const { $api } = useApi()
  return useMutation({ mutationFn: ({ projectId, id }: { projectId: number; id: number }) => $api(`/api/v1/projects/${projectId}/register/${id}`, { method: 'DELETE' }), onSuccess: (_, { projectId, id }) => { qc.removeQueries({ queryKey: projectGovernanceKeys.registerItem(projectId, id), exact: true }); return invalidate(qc, projectId) } })
}


// A matrix viewport is directly addressable: offset does not require fetching
// all preceding pages after refreshing a deep link.
export function useGovernanceTaskPage(projectId: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<{ q?: string; closed: boolean; offset: number }>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...projectGovernanceKeys.all(toValue(projectId) ?? 0), 'task-page', toValue(params)]),
    enabled: computed(() => !!toValue(projectId)),
    queryFn: () => $api('/api/v1/tasks', { query: { project_id: toValue(projectId), q: toValue(params).q || undefined, closed: toValue(params).closed ? 1 : 0, limit: 50, offset: toValue(params).offset }, schema: TaskListSchema }),
  })
}
