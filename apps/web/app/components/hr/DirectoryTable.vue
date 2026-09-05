<script setup lang="ts">
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { Search } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { useHrEmployees, type HrEmployee } from '@/composables/useHrEmployees'

const departmentId = defineModel<number | null>('departmentId', { default: null })
const emit = defineEmits<{ open: [id: number] }>()

const { t } = useI18n()
// SSR renders the department Select trigger and search input as real,
// focusable/clickable markup before Nuxt hydrates and attaches reka-ui's
// listeners; a click in that window is silently dropped (see
// useHydrated()). Gate both on hydration, same as TaskToolbar.vue.
const hydrated = useHydrated()
const search = ref('')
const debouncedSearch = refDebounced(search, 300)

const params = computed(() => ({
  q: debouncedSearch.value || undefined,
  department_id: departmentId.value ?? undefined,
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
