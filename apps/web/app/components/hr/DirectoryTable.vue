<script setup lang="ts">
import { hrAccessBadge } from '@/utils/hrAccessBadge'
import type { TableColumn } from '@nuxt/ui'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useArchiveHrEmployee, useHrEmployees, useUnarchiveHrEmployee, type HrEmployee } from '@/composables/useHrEmployees'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'
import { refDebounced } from '@vueuse/core'

const departmentId = defineModel<number | null>('departmentId', { default: null })
const emit = defineEmits<{ manage: [id: number] }>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
// SSR renders the department select trigger and search input as real,
// focusable/clickable markup before Nuxt hydrates and attaches its
// listeners; a click in that window is silently dropped (see
// useHydrated()). Gate both on hydration, same as TaskToolbar.vue.
const hydrated = useHydrated()
const search = ref(String(route.query.q ?? ''))
const debouncedSearch = refDebounced(search, 250)
const hasPendingSearch = computed(() => hasPendingHrSearch(search.value, route.query.q))
const committedListParams = computed(() => hrCommittedListParams(route.query))
const archived = ref(route.query.archived === '1')
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const { can } = useAccess()
const canManage = computed(() => can('hr.employees.manage'))
const canArchive = computed(() => can('hr.employees.archive'))
// The server fills `access` only for callers holding this capability; without it the account column is hidden.
const canSeeAccess = computed(() => can('hr.employees.access_status.read'))
const pendingArchiveId = ref<number | null>(null)
const { mutateAsync: archiveEmployee, isPending: archiving } = useArchiveHrEmployee()
const { mutateAsync: unarchiveEmployee, isPending: unarchiving } = useUnarchiveHrEmployee()
const archivePending = computed(() => archiving.value || unarchiving.value)
const pendingEmployee = computed(() => items.value.find(item => item.id === pendingArchiveId.value) ?? null)
async function confirmPendingArchive() {
  const employee = pendingEmployee.value
  if (!employee || !hydrated.value) return
  if (employee.active) await archiveEmployee(employee.id)
  else await unarchiveEmployee(employee.id)
  pendingArchiveId.value = null
}

const params = computed(() => {
  const query = route.query
  const department = typeof query.department_id === 'string' ? Number(query.department_id) : NaN
  return {
    ...hrCommittedListParams(query),
    department_id: Number.isSafeInteger(department) && department > 0 ? department : undefined,
    archived: query.archived === '1' || undefined,
    limit: 25,
  }
})

const { data, isLoading, error, refetch } = useHrEmployees(params)
const { data: deptData } = useHrDepartments()

const items = computed<HrEmployee[]>(() => data.value?.items ?? [])
const departments = computed(() => deptData.value?.items ?? [])
const selectedDepartment = computed(() => departments.value.find(item => item.id === departmentId.value) ?? null)
const departmentOptions = computed(() => [{ value: 'all', label: t('hr.directory.allDepartments') }, ...departments.value.map(dept => ({ value: String(dept.id), label: dept.name }))])
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())) + Number(departmentId.value !== null))
const hasActiveFilters = computed(() => activeFilterCount.value > 0)
const page = computed(() => Math.floor(committedListParams.value.offset / 25) + 1)
const total = computed(() => data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / 25)))
const showEmpty = computed(() => !isLoading.value && !error.value && items.value.length === 0)
const scopes = computed(() => [
  { value: 'active', label: t('hr.directory.scopeActive') },
  { value: 'archived', label: t('hr.directory.scopeArchived') },
])
const showActions = computed(() => canManage.value || canArchive.value)

watch(() => [route.query.q, route.query.department_id, route.query.archived, route.query.offset], ([q, department, archivedQuery, nextOffset]) => {
  search.value = String(q ?? '')
  const id = typeof department === 'string' ? Number(department) : NaN
  departmentId.value = Number.isSafeInteger(id) && id > 0 ? id : null
  archived.value = archivedQuery === '1'
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
}, { immediate: true })
watch(debouncedSearch, (value) => { if (value !== String(route.query.q ?? '')) updateQuery() })

function updateQuery() {
  if ((route.path.replace(/\/+$/, '') || '/') !== '/hr') return
  offset.value = 0
  void router.replace({ query: { ...route.query, ...(search.value.trim() ? { q: search.value.trim() } : { q: undefined }), ...(departmentId.value ? { department_id: departmentId.value } : { department_id: undefined }), ...(archived.value ? { archived: '1' } : { archived: undefined }), offset: undefined } })
}
function setPage(next: number) {
  if (!hydrated.value || isLoading.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  if ((route.path.replace(/\/+$/, '') || '/') !== '/hr') return
  offset.value = (next - 1) * 25
  void router.replace({ query: { ...route.query, ...(offset.value ? { offset: offset.value } : { offset: undefined }) } })
}

function actionsFor(employee: HrEmployee): RowAction[] {
  return [
    ...(canManage.value ? [{ label: t('hr.directory.manage'), icon: 'i-lucide-pencil', onSelect: () => emit('manage', employee.id) } satisfies RowAction] : []),
    ...(canArchive.value ? [{
      label: employee.active ? t('hr.employee.archive') : t('hr.employee.unarchive'),
      icon: employee.active ? 'i-lucide-archive' : 'i-lucide-archive-restore',
      destructive: employee.active,
      onSelect: () => { pendingArchiveId.value = employee.id },
    } satisfies RowAction] : []),
  ]
}

// The name link of every table: the strongest column, in the same recipe as ProjectTable.
const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

function employeeTo(id: number) {
  return { path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) }
}

function rowTo(employee: HrEmployee) { return employeeTo(employee.id) }

// Narrow columns are fixed px (a pill or an avatar never clips), the name absorbs the rest and truncates; the table's
// minimum width is the sum of its columns, and below it the table scrolls sideways (the same recipe as ProjectTable).
const WIDTH = {
  name: 'min-w-[240px]',
  department: 'w-[176px] min-w-[176px]',
  manager: 'w-[104px] min-w-[104px]',
  status: 'w-[112px] min-w-[112px]',
  access: 'w-[144px] min-w-[144px]',
  manage: 'w-[56px] min-w-[56px]',
}
function column(id: string, header: string, width: string, fit = true): TableColumn<HrEmployee> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<HrEmployee>['meta'] }
}
const columns = computed<TableColumn<HrEmployee>[]>(() => [
  column('name', t('hr.directory.columns.name'), WIDTH.name, false),
  column('department', t('hr.directory.columns.department'), WIDTH.department, false),
  column('manager', t('hr.directory.columns.manager'), WIDTH.manager),
  column('status', t('hr.directory.columns.status'), WIDTH.status),
  ...(canSeeAccess.value ? [column('access', t('hr.directory.columns.account'), WIDTH.access)] : []),
  ...(showActions.value ? [column('manage', t('hr.directory.columns.actions'), WIDTH.manage)] : []),
])

function onDepartmentChange(value: unknown) {
  departmentId.value = value === 'all' || !value ? null : Number(value)
  updateQuery()
}
function onScopeChange(value: string | number) {
  if (!hydrated.value) return
  archived.value = value === 'archived'
  updateQuery()
}
function clearSearch() {
  search.value = ''
  updateQuery()
}
function clearFilters() {
  search.value = ''
  departmentId.value = null
  updateQuery()
}
</script>

<template>
  <SharedListCard>
    <template #filters>
      <div class="w-full min-w-0">
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="search" :disabled="!hydrated" :placeholder="t('hr.directory.search')" :aria-label="t('hr.directory.search')" icon="i-lucide-search" class="min-w-48 flex-1" />
          </template>
          <template v-if="can('hr.departments.read')" #default>
            <USelect id="hr-directory-department" class="w-full md:w-48" :model-value="departmentId ? String(departmentId) : 'all'" :items="departmentOptions" :aria-label="t('hr.directory.columns.department')" :disabled="!hydrated" @update:model-value="onDepartmentChange" />
          </template>
          <template v-if="canArchive" #view>
            <SharedSegmentedControl
              data-testid="hr-directory-scope"
              :label="t('hr.directory.columns.status')"
              :items="scopes"
              :model-value="archived ? 'archived' : 'active'"
              @update:model-value="onScopeChange"
            />
          </template>
          <template #active>
            <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="search.trim()" :label="t('hr.directory.searchValue', { value: search })" @remove="clearSearch" />
              <SharedFilterChip v-if="selectedDepartment" :label="selectedDepartment.name" @remove="onDepartmentChange('all')" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>

    <SharedInlineConfirm
      v-if="pendingEmployee"
      class="m-(--webvue-card-pad-dense)"
      :color="pendingEmployee.active ? 'error' : 'primary'"
      :title="t('hr.employee.archiveConfirm')"
      :description="pendingEmployee.name"
      :confirm-label="pendingEmployee.active ? t('hr.employee.archive') : t('hr.employee.unarchive')"
      :pending="archivePending"
      @confirm="confirmPendingArchive"
      @cancel="pendingArchiveId = null"
    />

    <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(hasActiveFilters ? 'hr.directory.filteredEmpty' : 'hr.directory.empty')" :description="hasActiveFilters ? t('hr.directory.filteredEmptyHint') : undefined">
      <template v-if="hasActiveFilters" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('hr.directory.clear')" @click="clearFilters" /></template>
    </SharedEmptyState>
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,832px)] [&_table]:table-fixed">
      <SharedDataTable
        bare
        :rows="items"
        :columns="columns"
        row-key="id"
        :row-to="rowTo"
        :loading="isLoading"
        :error="error"
        :caption="t('hr.directory.title')"
        @retry="refetch"
      >
        <template #name-cell="{ row }">
          <div class="flex min-w-0 items-center gap-3">
            <SharedPersonAvatar :people="[{ id: row.original.id, name: row.original.name }]" />
            <div class="min-w-0">
              <NuxtLink :to="employeeTo(row.original.id)" :class="NAME_LINK" data-testid="hr-employee-name">{{ row.original.name }}</NuxtLink>
              <p v-if="row.original.job_title" class="truncate text-xs text-muted">{{ row.original.job_title }}</p>
            </div>
          </div>
        </template>
        <template #department-cell="{ row }"><template v-if="row.original.department?.name">{{ row.original.department.name }}</template><template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template></template>
        <template #manager-cell="{ row }"><SharedPersonAvatar :people="row.original.manager ? [row.original.manager] : []" /></template>
        <template #status-cell="{ row }"><SharedStatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="t(row.original.active ? 'hr.directory.status.active' : 'hr.directory.status.archived')" /></template>
        <template v-if="canSeeAccess" #access-cell="{ row }"><SharedStatusBadge size="sm" data-testid="hr-access-badge" :tone="hrAccessBadge(row.original.access).tone" :label="t(hrAccessBadge(row.original.access).labelKey)" /></template>
        <template v-if="showActions" #manage-cell="{ row }">
          <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('hr.directory.rowActions', { name: row.original.name })" /></div>
        </template>
        <template #mobile-row="{ row }">
          <div class="flex items-start gap-3">
            <SharedPersonAvatar :people="[{ id: row.id, name: row.name }]" />
            <div class="min-w-0 flex-1">
              <NuxtLink :to="employeeTo(row.id)" :class="NAME_LINK" data-testid="hr-employee-name">{{ row.name }}</NuxtLink>
              <p v-if="row.job_title" class="truncate text-xs text-muted">{{ row.job_title }}</p>
              <p v-if="row.department?.name || row.manager?.name" class="mt-1 truncate text-xs text-muted">{{ [row.department?.name, row.manager?.name].filter(Boolean).join(' · ') }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <SharedStatusBadge v-if="canSeeAccess" size="sm" data-testid="hr-access-badge" :tone="hrAccessBadge(row.access).tone" :label="t(hrAccessBadge(row.access).labelKey)" />
              <SharedRowActions v-if="showActions" :actions="actionsFor(row)" :label="t('hr.directory.rowActions', { name: row.name })" />
            </div>
          </div>
        </template>
      </SharedDataTable>
    </div>
    <template v-if="data && !showEmpty" #footer>
      <SharedListFooter :count-label="t('hr.directory.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="isLoading" @update:page="setPage" />
    </template>
  </SharedListCard>
</template>
