import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrAssetCategoryListSchema,
  HrEquipmentListSchema,
  HrEquipmentSchema,
  HrRefSchema,
  type HrAssetCategoryCreate,
  type HrEquipment,
  type HrEquipmentCreate,
  type HrEquipmentPatch,
} from '@webvue/contracts'

type Api = ReturnType<typeof useApi>['$api']

/** The page size the equipment list asks for; the server caps it at 200. */
export const HR_ASSETS_PAGE_SIZE = 25
const MAX_LIMIT = 100

export const hrAssetKeys = {
  all: ['hr', 'assets'] as const,
  categories: ['hr', 'assets', 'categories'] as const,
  equipmentList: (query: HrEquipmentQuery) => ['hr', 'assets', 'equipment', 'list', query] as const,
  equipment: (id: number) => ['hr', 'assets', 'equipment', 'detail', id] as const,
  mine: ['hr', 'assets', 'me'] as const,
}

export type HrEquipmentActiveFilter = 'true' | 'false' | 'all'
export type HrEquipmentAssignedFilter = 'true' | 'false'

export interface HrEquipmentQuery {
  q?: string
  category_id?: number
  employee_id?: number
  assigned?: HrEquipmentAssignedFilter
  active?: HrEquipmentActiveFilter
  limit?: number
  offset?: number
}

export interface HrEquipmentInput {
  q?: string
  categoryId?: number | null
  employeeId?: number | null
  assigned?: HrEquipmentAssignedFilter | 'all'
  active?: HrEquipmentActiveFilter
  limit?: number
  offset?: number
}

function page(input: { limit?: number; offset?: number }) {
  // A missing, zero or negative limit is the route default, exactly like the server's parse_page.
  const asked = input.limit
  const limit = Number.isFinite(asked) && (asked as number) > 0
    ? Math.min(Math.trunc(asked as number), MAX_LIMIT)
    : HR_ASSETS_PAGE_SIZE
  const offset = Number.isInteger(input.offset) && (input.offset as number) > 0 ? (input.offset as number) : 0
  return { limit, offset }
}

/** The query string of one equipment list request; the server defaults `active` to true. */
export function hrEquipmentQuery(input: HrEquipmentInput): HrEquipmentQuery {
  return {
    q: input.q?.trim() || undefined,
    category_id: input.categoryId ?? undefined,
    employee_id: input.employeeId ?? undefined,
    assigned: input.assigned && input.assigned !== 'all' ? input.assigned : undefined,
    active: input.active && input.active !== 'true' ? input.active : undefined,
    ...page(input),
  }
}

/** A write answers with the full equipment shape: replace it in the cache, then refresh the lists. */
function replaceEquipment(qc: QueryClient, equipment: HrEquipment) {
  qc.setQueryData(hrAssetKeys.equipment(equipment.id), equipment)
  void qc.invalidateQueries({ queryKey: ['hr', 'assets', 'equipment', 'list'] })
  // The holder's own custody list changes with any assignment write.
  void qc.invalidateQueries({ queryKey: hrAssetKeys.mine })
}

export async function createHrAssetCategory($api: Api, qc: QueryClient, body: HrAssetCategoryCreate) {
  const category = await $api('/api/v1/hr/assets/categories', {
    method: 'POST', body, schema: HrRefSchema,
  })
  void qc.invalidateQueries({ queryKey: hrAssetKeys.categories })
  return category
}

export async function createHrEquipment($api: Api, qc: QueryClient, body: HrEquipmentCreate) {
  const equipment = await $api('/api/v1/hr/assets/equipment', {
    method: 'POST', body, schema: HrEquipmentSchema,
  })
  replaceEquipment(qc, equipment)
  return equipment
}

export async function updateHrEquipment($api: Api, qc: QueryClient, { id, body }: { id: number; body: HrEquipmentPatch }) {
  const equipment = await $api(`/api/v1/hr/assets/equipment/${id}`, {
    method: 'PATCH', body, schema: HrEquipmentSchema,
  })
  replaceEquipment(qc, equipment)
  return equipment
}

export async function assignHrEquipment($api: Api, qc: QueryClient, { id, employeeId, assignDate }: { id: number; employeeId: number; assignDate?: string }) {
  const equipment = await $api(`/api/v1/hr/assets/equipment/${id}/assign`, {
    method: 'POST',
    body: { employee_id: employeeId, assign_date: assignDate },
    schema: HrEquipmentSchema,
  })
  replaceEquipment(qc, equipment)
  return equipment
}

export async function returnHrEquipment($api: Api, qc: QueryClient, id: number) {
  const equipment = await $api(`/api/v1/hr/assets/equipment/${id}/return`, {
    method: 'POST', body: {}, schema: HrEquipmentSchema,
  })
  replaceEquipment(qc, equipment)
  return equipment
}

export async function archiveHrEquipment($api: Api, qc: QueryClient, { id, scrapDate }: { id: number; scrapDate?: string }) {
  const equipment = await $api(`/api/v1/hr/assets/equipment/${id}/archive`, {
    method: 'POST', body: { scrap_date: scrapDate }, schema: HrEquipmentSchema,
  })
  replaceEquipment(qc, equipment)
  return equipment
}

export function useHrAssetCategories() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrAssetKeys.categories,
    enabled: computed(() => can('hr.assets.read')),
    queryFn: () => $api('/api/v1/hr/assets/categories', { schema: HrAssetCategoryListSchema }),
  })
}

export function useHrEquipmentList(input: MaybeRefOrGetter<HrEquipmentInput>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrAssetKeys.equipmentList(hrEquipmentQuery(toValue(input)))),
    enabled: computed(() => can('hr.assets.read')),
    queryFn: () => $api('/api/v1/hr/assets/equipment', {
      query: { ...hrEquipmentQuery(toValue(input)) },
      schema: HrEquipmentListSchema,
    }),
  })
}

export function useHrEquipment(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrAssetKeys.equipment(toValue(id) ?? 0)),
    enabled: computed(() => can('hr.assets.read') && !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/assets/equipment/${toValue(id)}`, { schema: HrEquipmentSchema }),
  })
}

/** The caller's own custody (`/me`): gated by the employee read capability, not by the assets one. */
export function useMyHrAssets(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrAssetKeys.mine,
    enabled: computed(() => toValue(enabled) && can('hr.employees.read')),
    queryFn: () => $api('/api/v1/hr/assets/me', { schema: HrEquipmentListSchema }),
  })
}

export function useCreateHrAssetCategory() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrAssetCategoryCreate) => createHrAssetCategory($api, qc, body) })
}

export function useCreateHrEquipment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrEquipmentCreate) => createHrEquipment($api, qc, body) })
}

export function useUpdateHrEquipment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: HrEquipmentPatch }) => updateHrEquipment($api, qc, { id, body }) })
}

export function useAssignHrEquipment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, employeeId, assignDate }: { id: number; employeeId: number; assignDate?: string }) =>
      assignHrEquipment($api, qc, { id, employeeId, assignDate }),
  })
}

export function useReturnHrEquipment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (id: number) => returnHrEquipment($api, qc, id) })
}

export function useArchiveHrEquipment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, scrapDate }: { id: number; scrapDate?: string }) => archiveHrEquipment($api, qc, { id, scrapDate }) })
}

// HrRef is not re-exported: Nuxt auto-imports every composable export, so a second owner
// of the name would break the auto-import map. Import it from @webvue/contracts.
export type { HrEquipment }
