<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

// The list view of /hr/departments on SharedDataTable. A row opens its department through `rowTo`
// (the same `departmentTo` target the tree uses); delete is handed to the page, which owns the inline
// confirmation. `departmentTo` and `actionsFor` are read by hrReturnChain.test.ts.
const props = withDefaults(defineProps<{
  departments: HrDepartment[]
  canManage?: boolean
  canDelete?: boolean
}>(), { canDelete: true })
const emit = defineEmits<{ delete: [department: HrDepartment] }>()
const hydrated = useHydrated()
const { can } = useAccess()
const route = useRoute()
const { t } = useI18n()
const canManage = computed(() => !!props.canManage && can('hr.departments.manage'))

// Narrow columns are fixed px, the name absorbs the rest and truncates (the same recipe as ProjectTable).
const WIDTH = {
  name: 'min-w-[240px]',
  manager: 'w-[104px] min-w-[104px]',
  employees: 'w-[128px] min-w-[128px]',
  actions: 'w-[56px] min-w-[56px]',
}
function column(id: string, header: string, width: string, fit = true): TableColumn<HrDepartment> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<HrDepartment>['meta'] }
}
const columns = computed<TableColumn<HrDepartment>[]>(() => [
  column('name', t('hr.depts.name'), WIDTH.name, false),
  column('manager', t('hr.depts.manager'), WIDTH.manager),
  column('employees', t('hr.tabs.employees'), WIDTH.employees),
  ...(canManage.value ? [column('actions', t('hr.directory.columns.actions'), WIDTH.actions)] : []),
])
// The name link of every table: the strongest column, in the same recipe as ProjectTable.
const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

function departmentTo(id: number) {
  return { path: `/hr/departments/${id}`, query: returnToQuery(route.fullPath) }
}
function rowTo(department: HrDepartment) { return departmentTo(department.id) }
function actionsFor(department: HrDepartment): RowAction[] {
  return [
    { label: t('hr.depts.edit'), icon: 'i-lucide-pencil', to: { path: `/hr/departments/${department.id}/edit`, query: returnToQuery(route.fullPath) } },
    ...(props.canDelete ? [{ label: t('hr.depts.delete'), icon: 'i-lucide-trash-2', destructive: true, onSelect: () => emit('delete', department) } satisfies RowAction] : []),
  ]
}
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,528px)] [&_table]:table-fixed">
    <SharedDataTable
      bare
      data-testid="hr-department-table"
      :rows="departments"
      :columns="columns"
      row-key="id"
      :row-to="rowTo"
      :empty-text="t('hr.depts.empty')"
      :caption="t('hr.depts.title')"
    >
      <template #name-cell="{ row }">
        <NuxtLink :to="departmentTo(row.original.id)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.original.name }}</NuxtLink>
      </template>
      <template #manager-cell="{ row }"><SharedPersonAvatar :people="row.original.manager ? [row.original.manager] : []" /></template>
      <template #employees-cell="{ row }"><span class="tabular-nums text-muted">{{ row.original.employee_count }}</span></template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('hr.depts.rowActions', { name: row.original.name })" /></div>
      </template>
      <template #mobile-row="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <NuxtLink :to="departmentTo(row.id)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.name }}</NuxtLink>
            <p class="mt-1 truncate text-xs" :class="row.manager ? 'text-muted' : 'text-dimmed'">{{ row.manager?.name || t('hr.depts.noManager') }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <span class="text-xs tabular-nums text-muted">{{ row.employee_count }}</span>
            <SharedRowActions v-if="canManage" :actions="actionsFor(row)" :label="t('hr.depts.rowActions', { name: row.name })" />
          </div>
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
