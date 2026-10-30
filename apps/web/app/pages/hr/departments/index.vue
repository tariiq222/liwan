<script setup lang="ts">
import DepartmentOrgChart from '@/components/hr/DepartmentOrgChart.vue'
import DepartmentTable from '@/components/hr/DepartmentTable.vue'
import DepartmentTree from '@/components/hr/DepartmentTree.vue'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import { buildDepartmentTree } from '@/lib/departmentTree'
import { departmentKpiTiles } from '@/utils/hrKpis'
import { ApiError } from '@/composables/useApi'
import { useDeleteHrDepartment, useHrDepartments, type HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const query = useHrDepartments()
const hydrated = useHydrated()
const toast = useToast()
const listPath = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/hr/departments')
const search = computed({ get: () => typeof route.query.q === 'string' ? route.query.q : '', set: q => { if (!listPath.value) return; void router.replace({ query: { ...route.query, q: q || undefined } }) } })
// The current view: `tree` or `canvas`, anything else (an unknown value, `table`, a repeated `view`)
// is the list. Same rule as SharedListPage's switch (first option = default), written here without an
// import because hrReturnChain.test.ts evaluates this script with a fixed binding list.
const view = computed(() => {
  const asked = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  return asked === 'tree' || asked === 'canvas' ? asked : 'list'
})
const treeView = computed(() => view.value === 'tree')
const canvasView = computed(() => view.value === 'canvas')
const views = computed(() => [
  { value: 'list', label: t('hr.depts.listView'), icon: 'i-lucide-list', testId: 'hr-departments-view-list' },
  { value: 'tree', label: t('hr.depts.hierarchy'), icon: 'i-lucide-network', testId: 'hr-departments-view-tree' },
  { value: 'canvas', label: t('hr.depts.orgChart'), icon: 'i-lucide-scan', testId: 'hr-departments-view-canvas' },
])
// The create panel (departments/new.vue) returns to this list with the state it was showing and drops
// a referrer's returnTo, so the link carries the list state only.
const createTo = computed(() => {
  if (!can('hr.departments.manage')) return undefined
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr/departments/new', query: listQuery }
})
const departments = computed(() => query.data.value?.items ?? [])
// The list is fetched page by page until the server total is reached, so the tiles count the complete list.
const kpiTiles = computed(() => departmentKpiTiles(query.data.value?.items ?? null, t))
const roots = computed(() => buildDepartmentTree(departments.value))
const filtered = computed(() => departments.value.filter(d => `${d.name} ${d.manager?.name ?? ''}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())))
const deleting = ref<HrDepartment | null>(null)
const deleteError = ref<ApiError | null>(null)
const { mutateAsync: deleteDepartment, isPending: deletingPending } = useDeleteHrDepartment()
function openDepartment(id: number) { void navigateTo({ path: `/hr/departments/${id}`, query: returnToQuery(route.fullPath) }) }
function editDepartment(id: number) { void navigateTo({ path: `/hr/departments/${id}/edit`, query: returnToQuery(route.fullPath) }) }
function createChild(id: number) { void navigateTo({ path: '/hr/departments/new', query: { ...returnToQuery(route.fullPath), parent_id: id } }) }
function clearFilters() { search.value = '' }
function askDelete(department: HrDepartment) { deleting.value = department; deleteError.value = null }
async function confirmDelete() {
  if (!deleting.value || !hydrated.value || deletingPending.value || !can('hr.departments.manage')) return
  try { await deleteDepartment(deleting.value.id); deleting.value = null; toast.add({ title: t('hr.depts.deleted'), color: 'success' }) }
  catch (error) { deleteError.value = error instanceof ApiError ? error : new ApiError(500, 'http_error', t('errors.generic')) }
}
</script>
<template>
  <SharedListPage
    :title="t('nav.departments')"
    :create-to="createTo"
    :create-label="t('hr.depts.new')"
    create-test-id="hr-department-new"
    :views="views"
    views-in-filters
    kpi-toggle
  >
    <SharedKpiStrip :tiles="kpiTiles" :loading="query.isLoading.value" :label="t('hr.kpi.departmentsLabel')" data-testid="hr-department-kpi-strip" />
    <!-- The org chart is a screen-sized surface, so its card docks and fills the viewport; the list and tree are ordinary cards. -->
    <SharedListCard :fill="canvasView">
      <template #filters>
        <div class="w-full min-w-0">
          <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput v-model="search" class="min-w-48 flex-1" :disabled="!hydrated" :aria-label="t('hr.depts.search')" :placeholder="t('hr.depts.search')" icon="i-lucide-search" />
            </template>
            <template #active>
              <div v-if="search.trim()" class="flex flex-wrap items-center gap-2">
                <SharedFilterChip :label="t('hr.directory.searchValue', { value: search })" @remove="clearFilters" />
              </div>
            </template>
          </FilterBar>
        </div>
      </template>
      <SharedInlineConfirm
        v-if="deleting"
        class="m-(--liwan-card-pad-dense)"
        :title="t('hr.depts.deleteConfirm', { name: deleting.name })"
        :description="deleteError?.message"
        :confirm-label="t('hr.depts.delete')"
        :pending="deletingPending"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      />
      <SharedPageState v-if="query.isLoading.value || query.error.value || !departments.length" class="m-(--liwan-card-pad-dense)" :loading="query.isLoading.value" :error="query.error.value" :empty="!departments.length" @retry="query.refetch" />
      <DepartmentOrgChart v-else-if="canvasView" :roots="roots" :query="search" :hydrated="hydrated" :return-to="route.fullPath" />
      <DepartmentTree v-else-if="treeView" :roots="roots" :query="search" :hydrated="hydrated" :can-manage="can('hr.departments.manage')" :can-read-employees="can('hr.employees.read')" :can-read-documents="can('documents.items.read')" @select="openDepartment" @edit="editDepartment" @create-child="createChild" />
      <DepartmentTable v-else :departments="filtered" :can-manage="can('hr.departments.manage')" @delete="askDelete" />
      <template v-if="departments.length" #footer>
        <SharedListFooter :count-label="t('hr.depts.footer.results', { count: filtered.length }, filtered.length)" :page="1" :pages="1" />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
