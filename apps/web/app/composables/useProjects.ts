import { toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { PROJECT_STATUSES, ProjectDashboardSummarySchema, ProjectDetailSchema, ProjectListSchema, type ProjectCharterAction, type ProjectCopyInput, type ProjectCreate, type ProjectDetail, type ProjectPatch, type ProjectPhase, type ProjectStatus } from '@webvue/contracts'
import { ApiError } from './useApi'
import { invalidateProjectCaches, projectKeys } from './projectKeys'
import { parseOffset } from '../utils/routeQuery'
import { projectPicker } from '../modules/pmo/recordPicker'

export const PROJECT_PAGE = 50

export type ProjectListFilters = {
  q?: string
  mine?: boolean
  sort?: 'default' | 'name' | 'progress'
  status?: 'unset' | ProjectStatus
  charterReview?: boolean
  limit?: number
  offset?: number
}

export type ProjectListStatusFilter = 'all' | 'unset' | ProjectStatus

export type ProjectListRouteState = {
  q: string
  mine: boolean
  status: ProjectListStatusFilter
  offset: number
  archived: boolean
  sort?: 'default' | 'name' | 'progress'
  view?: 'table' | 'cards'
}

export function parseProjectListOffset(value: unknown): number {
  return parseOffset(value)
}

export function parseProjectListStatus(value: unknown): ProjectListStatusFilter {
  if (value === 'unset') return 'unset'
  if (typeof value === 'string' && PROJECT_STATUSES.includes(value as ProjectStatus)) return value as ProjectStatus
  return 'all'
}

export function parseProjectListRoute(query: Record<string, unknown>): ProjectListRouteState {
  return {
    q: typeof query.q === 'string' ? query.q : '',
    mine: query.mine === '1' || query.mine === 'true',
    status: parseProjectListStatus(query.status),
    offset: parseProjectListOffset(query.offset),
    archived: query.archived === '1' || query.archived === 1,
    ...(query.sort === 'name' || query.sort === 'progress' ? { sort: query.sort } : {}),
    ...(query.view === 'cards' || query.view === 'table' ? { view: query.view } : {}),
  }
}

export function serializeProjectListRoute(state: ProjectListRouteState) {
  return {
    q: state.q.trim() || undefined,
    ...(state.mine ? { mine: '1' } : {}),
    status: state.status === 'all' ? undefined : state.status,
    offset: state.offset || undefined,
    archived: state.archived ? '1' : undefined,
    ...(state.sort && state.sort !== 'default' ? { sort: state.sort } : {}),
    ...(state.view === 'cards' || state.view === 'table' ? { view: state.view } : {}),
  }
}

export function patchProjectListRoute(
  current: ProjectListRouteState,
  patch: Partial<ProjectListRouteState>,
): ProjectListRouteState {
  const next: ProjectListRouteState = {
    q: patch.q ?? current.q,
    mine: patch.mine ?? current.mine,
    status: patch.status ?? current.status,
    offset: patch.offset ?? current.offset,
    archived: patch.archived ?? current.archived,
    sort: patch.sort ?? current.sort,
    view: patch.view ?? current.view,
  }
  if (patch.offset === undefined && (patch.q !== undefined || patch.mine !== undefined || patch.status !== undefined || patch.archived !== undefined || patch.sort !== undefined)) {
    next.offset = 0
  }
  return {
    q: next.q,
    mine: next.mine,
    status: parseProjectListStatus(next.status === 'all' ? undefined : next.status),
    offset: parseProjectListOffset(next.offset),
    archived: next.archived,
    ...(next.sort ? { sort: next.sort } : {}),
    ...(next.view ? { view: next.view } : {}),
  }
}

export function sameProjectListRoute(
  left: ReturnType<typeof serializeProjectListRoute>,
  right: ReturnType<typeof serializeProjectListRoute>,
) {
  return left.q === right.q && left.mine === right.mine && left.status === right.status && left.offset === right.offset && left.archived === right.archived && left.sort === right.sort && left.view === right.view
}

export function projectListQuery(archived: boolean, filters: ProjectListFilters = {}) {
  const rawLimit = filters.limit ?? 200
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 200
  const rawOffset = filters.offset ?? 0
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return {
    archived: archived ? 1 : undefined,
    ...(filters.mine ? { mine: 1 } : {}),
    q: filters.q?.trim() || undefined,
    status: filters.status,
    ...(filters.charterReview ? { charter_review: 1 } : {}),
    ...(filters.sort && filters.sort !== 'default' ? { sort: filters.sort } : {}),
    limit,
    offset,
  }
}

// Minimal {id, name} refs for pickers (create-task dialog, مهامي project filter, ⌘K). The
// project picker the PMO manifest declares owns the request, so other applications get the same list.
export function useProjects(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: projectPicker.queryKey,
    enabled: computed(() => toValue(enabled)),
    queryFn: ({ signal }) => projectPicker.options($api, signal),
    staleTime: 5 * 60 * 1000,
  })
}

// The projects table: status + progress per project.
export function useProjectList(archived: Ref<boolean>, filters: MaybeRefOrGetter<ProjectListFilters> = {}) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => [...projectKeys.list, projectListQuery(archived.value, toValue(filters))] as const),
    queryFn: () => $api('/api/v1/projects', { query: projectListQuery(archived.value, toValue(filters)), schema: ProjectListSchema }),
  })
}

export type ProjectSummaryFilters = Pick<ProjectListFilters, 'q' | 'mine' | 'status'>

function projectSummaryQuery(filters: ProjectSummaryFilters) {
  return { q: filters.q?.trim() || undefined, mine: filters.mine ? 1 : undefined, status: filters.status }
}

// The headline counts above the projects list, for the same filters as the list (no paging).
export function useProjectSummary(filters: MaybeRefOrGetter<ProjectSummaryFilters>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.summary(projectSummaryQuery(toValue(filters)))),
    queryFn: () => $api('/api/v1/reports/projects/summary', { query: projectSummaryQuery(toValue(filters)), schema: ProjectDashboardSummarySchema }),
  })
}

/** True once the project cannot be shown to this user: an unusable id, or a read answered 404 (missing) or 403 (hidden). Shares the cached read of `useProject`. */
export function useProjectMissing(id: Ref<number | null>) {
  const { error } = useProject(id)
  return computed(() => id.value === null || !Number.isInteger(id.value) || id.value <= 0
    || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
}

export function useProject(id: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.detail(id.value ?? 0)),
    enabled: computed(() => !!id.value),
    queryFn: () => $api(`/api/v1/projects/${id.value}`, { schema: ProjectDetailSchema }),
  })
}

export function isStaleProjectWrite(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'stale_write'
}

export function useCreateProject() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: ProjectCreate) => $api('/api/v1/projects', { method: 'POST', body, schema: ProjectDetailSchema }),
    onSuccess: (detail) => {
      qc.setQueryData(projectKeys.detail(detail.id), detail)
      invalidateProjectCaches(qc)
    },
  })
}

// Copies the structure of project `id` into a new project; the server answers 201 with the new project.
export function useCopyProject() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ProjectCopyInput }) =>
      $api(`/api/v1/projects/${id}/copy`, { method: 'POST', body, schema: ProjectDetailSchema }),
    onSuccess: (detail) => {
      qc.setQueryData(projectKeys.detail(detail.id), detail)
      invalidateProjectCaches(qc)
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
      // Native name/description may update optimistically. Charter writes stay
      // in local form state so a refetch or 409 cannot wipe unsaved rows.
      if (prev && patch.charter === undefined) {
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
      invalidateProjectCaches(qc)
    },
  })
}

export function useCharterTransition() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, action, expected, note }: { id: number; action: ProjectCharterAction; expected: string; note?: string }) =>
      $api(`/api/v1/projects/${id}/charter/${action}`, {
        method: 'POST',
        body: action === 'return' ? { expected_updated_at: expected, note } : { expected_updated_at: expected },
        schema: ProjectDetailSchema,
      }),
    onSuccess: (detail: ProjectDetail, { id }) => {
      qc.setQueryData(projectKeys.detail(id), detail)
      invalidateProjectCaches(qc)
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
      invalidateProjectCaches(qc)
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

// Non-optimistic like the charter transitions: a gate can refuse, so the cache
// takes whatever the server returns.
export function useMoveProjectPhase() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, phase, expected, acknowledgeWarnings }: { id: number; phase: ProjectPhase; expected: string; acknowledgeWarnings?: boolean }) =>
      $api(`/api/v1/projects/${id}/phase`, { method: 'POST', body: { phase, expected_updated_at: expected, ...(acknowledgeWarnings ? { acknowledge_warnings: true } : {}) }, schema: ProjectDetailSchema }),
    onSuccess: (detail: ProjectDetail, { id }) => {
      qc.setQueryData(projectKeys.detail(id), detail)
      invalidateProjectCaches(qc)
    },
    // A refused gate or a stale token both mean the cached checks and write token are out of date.
    onError: (_error, { id }) => { void qc.invalidateQueries({ queryKey: projectKeys.detail(id) }) },
  })
}
