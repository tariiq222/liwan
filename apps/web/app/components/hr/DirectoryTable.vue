<script setup lang="ts">
import { hrAccessBadge } from '@/utils/hrAccessBadge'
import type { TableColumn } from '@nuxt/ui'
import FilterBar from '@/components/shared/data/FilterBar.vue'
import { avatarProps } from '@/utils/avatarTone'
import type { RowAction } from '@/components/shared/data/RowActions.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useArchiveHrEmployee, useHrEmployees, useUnarchiveHrEmployee, type HrEmployee } from '@/composables/useHrEmployees'
import { returnToQuery } from '@/utils/safeReturnTo'
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
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))
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

function employeeTo(id: number) {
  return { path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) }
}

function rowTo(employee: HrEmployee) { return employeeTo(employee.id) }

const columns = computed<TableColumn<HrEmployee>[]>(() => [
  { accessorKey: 'name', header: t('hr.directory.columns.name') },
  { accessorKey: 'department', header: t('hr.directory.columns.department') },
  { accessorKey: 'manager', header: t('hr.directory.columns.manager') },
  { accessorKey: 'status', header: t('hr.directory.columns.status') },
  { accessorKey: 'access', header: t('hr.directory.columns.account') },
  ...(showActions.value ? [{ accessorKey: 'manage', header: t('hr.directory.columns.actions') } as TableColumn<HrEmployee>] : []),
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
  <div class="grid gap-3">
    <div class="w-full min-w-0">
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" :disabled="!hydrated" :placeholder="t('hr.directory.search')" icon="i-lucide-search" class="min-w-48 flex-1" />
        </template>
        <template v-if="can('hr.departments.read')" #default>
          <SharedFilterField :label="t('hr.directory.columns.department')" for="hr-directory-department">
            <USelect id="hr-directory-department" :model-value="departmentId ? String(departmentId) : 'all'" :items="departmentOptions" class="w-full" :disabled="!hydrated" @update:model-value="onDepartmentChange" />
          </SharedFilterField>
        </template>
        <template v-if="canArchive" #view>
          <UTabs
            data-testid="hr-directory-scope"
            :model-value="archived ? 'archived' : 'active'"
            :items="[{ label: t('hr.directory.scopeActive'), value: 'active', disabled: !hydrated }, { label: t('hr.directory.scopeArchived'), value: 'archived', disabled: !hydrated }]"
            size="sm"
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

    <SharedInlineConfirm
      v-if="pendingEmployee"
      :color="pendingEmployee.active ? 'error' : 'primary'"
      :title="t('hr.employee.archiveConfirm')"
      :description="pendingEmployee.name"
      :confirm-label="pendingEmployee.active ? t('hr.employee.archive') : t('hr.employee.unarchive')"
      :pending="archivePending"
      @confirm="confirmPendingArchive"
      @cancel="pendingArchiveId = null"
    />

    <div v-if="!isLoading && !error && items.length === 0" class="overflow-hidden rounded-lg bg-default p-6 ring ring-default">
      <SharedEmptyState :title="t(hasActiveFilters ? 'hr.directory.filteredEmpty' : 'hr.directory.empty')" :description="hasActiveFilters ? t('hr.directory.filteredEmptyHint') : undefined">
        <template v-if="hasActiveFilters" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('hr.directory.clear')" @click="clearFilters" /></template>
      </SharedEmptyState>
    </div>
    <SharedDataTable
      v-else
      :rows="items"
      :columns="columns"
      row-key="id"
      :row-to="rowTo"
      :loading="isLoading"
      :error="error"
      :caption="t('hr.directory.title')"
      :page="page"
      :pages="pages"
      @update:page="setPage"
      @retry="refetch"
    >
      <template #name-cell="{ row }">
        <div class="flex min-w-0 items-center gap-2">
          <UAvatar v-bind="avatarProps(row.original.name, row.original.id)" size="xs" />
          <NuxtLink :to="employeeTo(row.original.id)" class="shrink-0 rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="hr-employee-name">{{ row.original.name }}</NuxtLink>
          <span v-if="row.original.job_title" class="min-w-0 truncate text-xs text-muted">{{ row.original.job_title }}</span>
        </div>
      </template>
      <template #department-cell="{ row }"><template v-if="row.original.department?.name">{{ row.original.department.name }}</template><template v-else><span aria-hidden="true" class="text-xs font-normal text-dimmed">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template></template>
      <template #manager-cell="{ row }">
        <div v-if="row.original.manager" class="flex min-w-0 items-center gap-1.5">
          <UAvatar v-bind="avatarProps(row.original.manager.name, row.original.manager.id)" size="2xs" />
          <span class="truncate">{{ row.original.manager.name }}</span>
        </div>
        <template v-else><span aria-hidden="true" class="text-xs font-normal text-dimmed">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template>
      </template>
      <template #status-cell="{ row }"><SharedStatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="t(row.original.active ? 'hr.directory.status.active' : 'hr.directory.status.archived')" /></template>
      <template #access-cell="{ row }"><SharedStatusBadge size="sm" data-testid="hr-access-badge" :tone="hrAccessBadge(row.original.access).tone" :label="t(hrAccessBadge(row.original.access).labelKey)" /></template>
      <template v-if="showActions" #manage-cell="{ row }">
        <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('hr.directory.rowActions', { name: row.original.name })" /></div>
      </template>
      <template #mobile-row="{ row }">
        <div class="flex items-start gap-3">
          <UAvatar v-bind="avatarProps(row.name, row.id)" size="md" />
          <div class="min-w-0 flex-1">
            <NuxtLink :to="employeeTo(row.id)" class="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="hr-employee-name">{{ row.name }}</NuxtLink>
            <p v-if="row.job_title" class="truncate text-xs text-muted">{{ row.job_title }}</p>
            <p v-if="row.department?.name || row.manager?.name" class="mt-1 truncate text-xs text-muted">{{ [row.department?.name, row.manager?.name].filter(Boolean).join(' · ') }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <SharedStatusBadge size="sm" data-testid="hr-access-badge" :tone="hrAccessBadge(row.access).tone" :label="t(hrAccessBadge(row.access).labelKey)" />
            <SharedRowActions v-if="showActions" :actions="actionsFor(row)" :label="t('hr.directory.rowActions', { name: row.name })" />
          </div>
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
