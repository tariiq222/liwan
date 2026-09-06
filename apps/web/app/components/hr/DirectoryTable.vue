<script setup lang="ts">
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { h, resolveComponent } from 'vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import EmptyState from '@/components/shared/EmptyState.vue'
import { Search, X } from '@lucide/vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees, type HrEmployee } from '@/composables/useHrEmployees'
import { returnToQuery } from '@/utils/safeReturnTo'
import AccessBadge from './AccessBadge.vue'

const departmentId = defineModel<number | null>('departmentId', { default: null })
const emit = defineEmits<{ open: [id: number]; manage: [id: number]; archive: [id: number] }>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
// SSR renders the department Select trigger and search input as real,
// focusable/clickable markup before Nuxt hydrates and attaches reka-ui's
// listeners; a click in that window is silently dropped (see
// useHydrated()). Gate both on hydration, same as TaskToolbar.vue.
const hydrated = useHydrated()
const search = ref(String(route.query.q ?? ''))
const archived = ref(route.query.archived === '1')
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const { can } = useAccess()
const canManage = computed(() => can('hr.employees.manage'))
const canArchive = computed(() => can('hr.employees.archive'))

const params = computed(() => ({
  q: search.value.trim() || undefined,
  department_id: departmentId.value ?? undefined,
  archived: archived.value || undefined,
  limit: 25,
  offset: offset.value,
}))

const { data, isLoading, error, refetch } = useHrEmployees(params)
const { data: deptData } = useHrDepartments()
const NuxtLink = resolveComponent('NuxtLink')

const items = computed<HrEmployee[]>(() => data.value?.items ?? [])
const departments = computed(() => deptData.value?.items ?? [])
const selectedDepartment = computed(() => departments.value.find(item => item.id === departmentId.value) ?? null)
const hasActiveFilters = computed(() => Boolean(search.value.trim()) || departmentId.value !== null)
const page = computed(() => Math.floor(offset.value / 25) + 1)
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))

watch(() => [route.query.q, route.query.department_id, route.query.archived, route.query.offset], ([q, department, archivedQuery, nextOffset]) => {
  search.value = String(q ?? '')
  const id = typeof department === 'string' ? Number(department) : NaN
  departmentId.value = Number.isSafeInteger(id) && id > 0 ? id : null
  archived.value = archivedQuery === '1'
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
}, { immediate: true })
watch(search, (value) => { if (value !== String(route.query.q ?? '')) updateQuery() })

function updateQuery() {
  offset.value = 0
  void router.replace({ query: { ...route.query, ...(search.value.trim() ? { q: search.value.trim() } : { q: undefined }), ...(departmentId.value ? { department_id: departmentId.value } : { department_id: undefined }), ...(archived.value ? { archived: '1' } : { archived: undefined }), offset: undefined } })
}
function setPage(next: number) {
  if (!hydrated.value || isLoading.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * 25
  void router.replace({ query: { ...route.query, ...(offset.value ? { offset: offset.value } : { offset: undefined }) } })
}

function employeeTo(id: number) {
  return { path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) }
}

function onRowClick(id: number, event: MouseEvent) {
  if (!hydrated.value) return
  const target = event.target as HTMLElement
  if (target.closest('a, button')) return
  emit('open', id)
}

const columnHelper = createColumnHelper<HrEmployee>()
const columns = computed(() => [
  columnHelper.accessor('name', {
    id: 'name',
    header: () => t('hr.directory.columns.name'),
    cell: (info) => h(NuxtLink, {
      to: employeeTo(info.row.original.id),
      class: 'font-medium hover:underline',
      'data-testid': 'hr-employee-name',
      onClick: (event: Event) => event.stopPropagation(),
    }, () => info.getValue()),
  }),
  columnHelper.display({
    id: 'jobTitle',
    header: () => t('hr.directory.columns.jobTitle'),
    cell: (info) => info.row.original.job_title || '—',
  }),
  columnHelper.display({
    id: 'department',
    header: () => t('hr.directory.columns.department'),
    cell: (info) => info.row.original.department?.name ?? '—',
  }),
  columnHelper.display({
    id: 'manager',
    header: () => t('hr.directory.columns.manager'),
    cell: (info) => info.row.original.manager?.name ?? '—',
  }),
  columnHelper.display({
    id: 'access',
    header: () => t('hr.directory.columns.account'),
    cell: (info) => h(AccessBadge, { access: info.row.original.access }),
  }),
  columnHelper.display({
    id: 'manage',
    header: () => canManage.value || canArchive.value ? t('hr.directory.columns.actions') : '',
    cell: (info) => canManage.value || canArchive.value
      ? h('div', { class: 'flex gap-1' }, [
          canManage.value ? h('button', {
            type: 'button', class: 'rounded-md border px-2 py-1 text-xs hover:bg-accent', disabled: !hydrated.value,
            'data-testid': 'hr-employee-manage', onClick: (event: Event) => { event.stopPropagation(); emit('manage', info.row.original.id) },
          }, t('hr.directory.manage')) : null,
          canArchive.value ? h('button', {
            type: 'button', class: 'rounded-md border px-2 py-1 text-xs hover:bg-accent', disabled: !hydrated.value,
            'data-testid': 'hr-employee-archive-row', onClick: (event: Event) => { event.stopPropagation(); emit('archive', info.row.original.id) },
          }, info.row.original.active ? t('hr.employee.archive') : t('hr.employee.unarchive')) : null,
        ])
      : null,
  }),
])

const table = useVueTable({
  get data() {
    return items.value
  },
  get columns() {
    return columns.value
  },
  getCoreRowModel: getCoreRowModel(),
})

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
  <div class="space-y-2">
    <FilterBar>
      <template #search>
      <div class="relative min-w-48 flex-1">
        <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input v-model="search" :disabled="!hydrated" :placeholder="t('hr.directory.search')" class="ps-8" @change="updateQuery" />
      </div>
      </template>
      <template #default>
      <Button v-if="canArchive" variant="outline" size="sm" :disabled="!hydrated" @click="archived = !archived; updateQuery()">
        {{ archived ? t('hr.directory.showActive') : t('hr.directory.showArchived') }}
      </Button>
      <Select v-if="can('hr.departments.read')" :model-value="departmentId ? String(departmentId) : 'all'" @update:model-value="onDepartmentChange">
        <SelectTrigger size="sm" class="w-48" :disabled="!hydrated">
          <SelectValue :placeholder="t('hr.directory.allDepartments')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('hr.directory.allDepartments') }}</SelectItem>
          <SelectItem v-for="dept in departments" :key="dept.id" :value="String(dept.id)">{{ dept.name }}</SelectItem>
        </SelectContent>
      </Select>
      </template>
      <template #active>
        <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
          <Badge v-if="search.trim()" variant="secondary">{{ t('hr.directory.searchValue', { value: search }) }}</Badge>
          <Badge v-if="selectedDepartment" variant="secondary">{{ selectedDepartment.name }}</Badge>
          <Button variant="ghost" size="sm" :disabled="!hydrated" @click="clearFilters"><X class="size-3.5" />{{ t('hr.directory.clear') }}</Button>
        </div>
      </template>
    </FilterBar>

    <SharedPageState :error="error" @retry="refetch">
    <div class="overflow-x-auto rounded-lg border border-border/80 bg-card">
      <Table>
        <TableHeader>
          <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <TableHead v-for="header in headerGroup.headers" :key="header.id" class="text-start">
              <FlexRender v-if="!header.isPlaceholder" :render="header.column.columnDef.header" :props="header.getContext()" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="isLoading">
            <TableRow v-for="n in 5" :key="n">
              <TableCell v-for="col in columns" :key="col.id">
                <Skeleton class="h-5 w-full" />
              </TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="items.length === 0" :colspan="columns.length">
            <EmptyState :title="t(hasActiveFilters ? 'hr.directory.filteredEmpty' : 'hr.directory.empty')" :description="hasActiveFilters ? t('hr.directory.filteredEmptyHint') : undefined">
              <template v-if="hasActiveFilters" #action><Button size="sm" :disabled="!hydrated" @click="clearFilters">{{ t('hr.directory.clear') }}</Button></template>
            </EmptyState>
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              class="cursor-pointer transition-colors hover:bg-muted/50"
              @click="onRowClick(row.original.id, $event)"
            >
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id" class="text-start">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
    </SharedPageState>
    <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground"><Button variant="ghost" :disabled="!hydrated || page === 1 || isLoading" @click="setPage(page - 1)">{{ t('access.previousPage') }}</Button><span>{{ t('access.pageOf', { page, pages }) }}</span><Button variant="ghost" :disabled="!hydrated || page >= pages || isLoading" @click="setPage(page + 1)">{{ t('access.nextPage') }}</Button></div>
  </div>
</template>
