<script setup lang="ts">
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { h } from 'vue'
import { Search } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees, type HrEmployee } from '@/composables/useHrEmployees'
import AccessBadge from './AccessBadge.vue'

const departmentId = defineModel<number | null>('departmentId', { default: null })
const emit = defineEmits<{ open: [id: number]; manage: [id: number]; archive: [id: number]; create: [] }>()

const { t } = useI18n()
// SSR renders the department Select trigger and search input as real,
// focusable/clickable markup before Nuxt hydrates and attaches reka-ui's
// listeners; a click in that window is silently dropped (see
// useHydrated()). Gate both on hydration, same as TaskToolbar.vue.
const hydrated = useHydrated()
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const archived = ref(false)
const { me } = useMe()
const canAdmin = computed(() => me.value?.role === 'admin')

const params = computed(() => ({
  q: debouncedSearch.value || undefined,
  department_id: departmentId.value ?? undefined,
  archived: archived.value || undefined,
  limit: 200,
  offset: 0,
}))

const { data, isLoading } = useHrEmployees(params)
const { data: deptData } = useHrDepartments()

const items = computed<HrEmployee[]>(() => data.value?.items ?? [])
const departments = computed(() => deptData.value?.items ?? [])

const columnHelper = createColumnHelper<HrEmployee>()
const columns = [
  columnHelper.accessor('name', {
    id: 'name',
    header: () => t('hr.directory.columns.name'),
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
    header: () => canAdmin.value ? t('hr.directory.columns.actions') : '',
    cell: (info) => canAdmin.value
      ? h('div', { class: 'flex gap-1' }, [
          h('button', {
            type: 'button', class: 'rounded-md border px-2 py-1 text-xs hover:bg-accent', disabled: !hydrated.value,
            'data-testid': 'hr-employee-manage', onClick: (event: Event) => { event.stopPropagation(); emit('manage', info.row.original.id) },
          }, t('hr.directory.manage')),
          info.row.original.access?.role === 'vendor' ? null : h('button', {
            type: 'button', class: 'rounded-md border px-2 py-1 text-xs hover:bg-accent', disabled: !hydrated.value,
            'data-testid': 'hr-employee-archive-row', onClick: (event: Event) => { event.stopPropagation(); emit('archive', info.row.original.id) },
          }, info.row.original.active ? t('hr.employee.archive') : t('hr.employee.unarchive')),
        ])
      : null,
  }),
]

const table = useVueTable({
  get data() {
    return items.value
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
})

function onDepartmentChange(value: unknown) {
  departmentId.value = value === 'all' || !value ? null : Number(value)
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="canAdmin" size="sm" :disabled="!hydrated" @click="emit('create')">
        {{ t('hr.directory.newEmployee') }}
      </Button>
      <Button v-if="canAdmin" variant="outline" size="sm" :disabled="!hydrated" @click="archived = !archived">
        {{ archived ? t('hr.directory.showActive') : t('hr.directory.showArchived') }}
      </Button>
      <Select :model-value="departmentId ? String(departmentId) : 'all'" @update:model-value="onDepartmentChange">
        <SelectTrigger size="sm" class="w-48" :disabled="!hydrated">
          <SelectValue :placeholder="t('hr.directory.allDepartments')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('hr.directory.allDepartments') }}</SelectItem>
          <SelectItem v-for="dept in departments" :key="dept.id" :value="String(dept.id)">{{ dept.name }}</SelectItem>
        </SelectContent>
      </Select>
      <div class="relative min-w-48 flex-1">
        <Search class="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="search" :disabled="!hydrated" :placeholder="t('hr.directory.search')" class="ps-8" />
      </div>
    </div>

    <div class="rounded-md border">
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
            <p class="text-muted-foreground">{{ t('hr.directory.empty') }}</p>
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              class="cursor-pointer"
              @click="emit('open', row.original.id)"
            >
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id" class="text-start">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
