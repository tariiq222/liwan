<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useArchiveHrEmployee, useHrEmployees, useUnarchiveHrEmployee, type HrEmployee } from '@/composables/useHrEmployees'
import { returnToQuery } from '@/utils/safeReturnTo'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'
import AccessBadge from './AccessBadge.vue'
import { refDebounced } from '@vueuse/core'

const departmentId = defineModel<number | null>('departmentId', { default: null })
const emit = defineEmits<{ open: [id: number]; manage: [id: number] }>()

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
  offset.value = 0
  void router.replace({ query: { ...route.query, ...(search.value.trim() ? { q: search.value.trim() } : { q: undefined }), ...(departmentId.value ? { department_id: departmentId.value } : { department_id: undefined }), ...(archived.value ? { archived: '1' } : { archived: undefined }), offset: undefined } })
}
function setPage(next: number) {
  if (!hydrated.value || isLoading.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * 25
  void router.replace({ query: { ...route.query, ...(offset.value ? { offset: offset.value } : { offset: undefined }) } })
}

function employeeTo(id: number) {
  return { path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) }
}

function onRowClick(id: number, event: Event) {
  if (!hydrated.value) return
  const target = event.target as HTMLElement
  if (target.closest('a, button')) return
  emit('open', id)
}

const columns = computed<TableColumn<HrEmployee>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('hr.directory.columns.name') },
  { accessorKey: 'job_title', header: t('hr.directory.columns.jobTitle') },
  { accessorKey: 'department', header: t('hr.directory.columns.department') },
  { accessorKey: 'manager', header: t('hr.directory.columns.manager') },
  { accessorKey: 'access', header: t('hr.directory.columns.account') },
  ...(showActions.value ? [{ accessorKey: 'manage', header: t('hr.directory.columns.actions') } as TableColumn<HrEmployee>] : []),
])

function onDepartmentChange(value: unknown) {
  departmentId.value = value === 'all' || !value ? null : Number(value)
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
        <template #default>
          <UButton v-if="canArchive" color="secondary" variant="outline" size="sm" :disabled="!hydrated" :label="archived ? t('hr.directory.showActive') : t('hr.directory.showArchived')" @click="archived = !archived; updateQuery()" />
          <USelect v-if="can('hr.departments.read')" :model-value="departmentId ? String(departmentId) : 'all'" :items="departmentOptions" size="sm" class="w-48" :disabled="!hydrated" @update:model-value="onDepartmentChange" />
        </template>
        <template #active>
          <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
            <UBadge v-if="search.trim()" color="neutral" variant="subtle">{{ t('hr.directory.searchValue', { value: search }) }}</UBadge>
            <UBadge v-if="selectedDepartment" color="neutral" variant="subtle">{{ selectedDepartment.name }}</UBadge>
          </div>
        </template>
      </FilterBar>
    </div>

    <UAlert v-if="pendingEmployee" role="alert" color="error" variant="subtle" :title="t('hr.employee.archiveConfirm')">
      <template #actions>
        <UButton color="error" :disabled="!hydrated || archivePending" :label="pendingEmployee.active ? t('hr.employee.archive') : t('hr.employee.unarchive')" @click="confirmPendingArchive" />
        <UButton color="neutral" variant="outline" :disabled="archivePending" :label="t('app.cancel')" @click="pendingArchiveId = null" />
      </template>
    </UAlert>

    <SharedPageState :error="error" @retry="refetch">
      <div class="min-w-0 space-y-2">
        <UCard v-if="isLoading" class="hidden divide-y divide-default overflow-hidden md:block" role="status" :aria-label="t('app.loading')">
          <div v-for="n in 5" :key="n" class="flex items-center gap-4 px-4 py-3">
            <USkeleton class="h-5 w-10" />
            <USkeleton class="h-5 flex-1" />
            <USkeleton class="h-5 w-24" />
            <USkeleton class="h-5 w-24" />
          </div>
        </UCard>
        <UCard v-else-if="items.length === 0">
          <SharedEmptyState :title="t(hasActiveFilters ? 'hr.directory.filteredEmpty' : 'hr.directory.empty')" :description="hasActiveFilters ? t('hr.directory.filteredEmptyHint') : undefined">
            <template v-if="hasActiveFilters" #action><UButton color="primary" size="sm" :disabled="!hydrated" :label="t('hr.directory.clear')" @click="clearFilters" /></template>
          </SharedEmptyState>
        </UCard>
        <template v-else>
          <UCard class="hidden overflow-hidden md:block" :ui="{ body: 'p-0' }">
            <div class="overflow-x-auto">
              <UTable :data="items" :columns="columns" :caption="t('hr.directory.title')" :ui="{ caption: 'sr-only' }" @select="(event, row) => onRowClick(row.original.id, event)">
                <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
                <template #name-cell="{ row }">
                  <NuxtLink :to="employeeTo(row.original.id)" class="font-medium hover:underline" data-testid="hr-employee-name" @click.stop>{{ row.original.name }}</NuxtLink>
                </template>
                <template #job_title-cell="{ row }">{{ row.original.job_title || '—' }}</template>
                <template #department-cell="{ row }">{{ row.original.department?.name ?? '—' }}</template>
                <template #manager-cell="{ row }">{{ row.original.manager?.name ?? '—' }}</template>
                <template #access-cell="{ row }"><AccessBadge :access="row.original.access" /></template>
                <template v-if="showActions" #manage-cell="{ row }">
                  <div class="flex gap-1" @click.stop>
                    <UButton v-if="canManage" color="secondary" variant="ghost" size="sm" :disabled="!hydrated" data-testid="hr-employee-manage" :label="t('hr.directory.manage')" @click="emit('manage', row.original.id)" />
                    <UButton v-if="canArchive" color="error" variant="ghost" size="sm" :disabled="!hydrated" data-testid="hr-employee-archive-row" :label="row.original.active ? t('hr.employee.archive') : t('hr.employee.unarchive')" @click="pendingArchiveId = row.original.id" />
                  </div>
                </template>
              </UTable>
            </div>
          </UCard>
          <ul class="md:hidden space-y-2" :aria-label="t('hr.directory.title')">
            <li v-for="employee in items" :key="employee.id" class="nasq-ui-record-surface p-4" tabindex="0" role="button" @click="onRowClick(employee.id, $event)" @keydown.enter="onRowClick(employee.id, $event)" @keydown.space.prevent="onRowClick(employee.id, $event)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <bdi class="block text-xs text-muted">#{{ employee.id }}</bdi>
                  <NuxtLink :to="employeeTo(employee.id)" class="font-medium hover:underline" data-testid="hr-employee-name" @click.stop>{{ employee.name }}</NuxtLink>
                </div>
                <AccessBadge :access="employee.access" />
              </div>
              <dl class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                <div><dt>{{ t('hr.directory.columns.jobTitle') }}</dt><dd>{{ employee.job_title || '—' }}</dd></div>
                <div><dt>{{ t('hr.directory.columns.department') }}</dt><dd>{{ employee.department?.name ?? '—' }}</dd></div>
                <div><dt>{{ t('hr.directory.columns.manager') }}</dt><dd>{{ employee.manager?.name ?? '—' }}</dd></div>
              </dl>
              <div v-if="showActions" class="mt-3 flex gap-2" @click.stop>
                <UButton v-if="canManage" color="secondary" variant="ghost" size="sm" :disabled="!hydrated" data-testid="hr-employee-manage" :label="t('hr.directory.manage')" @click="emit('manage', employee.id)" />
                <UButton v-if="canArchive" color="error" variant="ghost" size="sm" :disabled="!hydrated" data-testid="hr-employee-archive-row" :label="employee.active ? t('hr.employee.archive') : t('hr.employee.unarchive')" @click="pendingArchiveId = employee.id" />
              </div>
            </li>
          </ul>
        </template>
      </div>
    </SharedPageState>
    <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted">
      <UButton color="secondary" variant="ghost" :disabled="!hydrated || hasPendingSearch || page === 1 || isLoading" :label="t('access.previousPage')" @click="setPage(page - 1)" />
      <span>{{ t('access.pageOf', { page, pages }) }}</span>
      <UButton color="secondary" variant="ghost" :disabled="!hydrated || hasPendingSearch || page >= pages || isLoading" :label="t('access.nextPage')" @click="setPage(page + 1)" />
    </div>
  </div>
</template>
