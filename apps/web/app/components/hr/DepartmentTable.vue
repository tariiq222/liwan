<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'
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

const columns = computed<TableColumn<HrDepartment>[]>(() => [
  { accessorKey: 'name', header: t('hr.depts.name') },
  { accessorKey: 'manager', header: t('hr.depts.manager') },
  ...(canManage.value ? [{ accessorKey: 'actions', header: t('hr.directory.columns.actions') } as TableColumn<HrDepartment>] : []),
])

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
  <SharedDataTable
    data-testid="hr-department-table"
    :rows="departments"
    :columns="columns"
    row-key="id"
    :row-to="rowTo"
    :empty-text="t('hr.depts.empty')"
    :caption="t('hr.depts.title')"
  >
    <template #name-cell="{ row }">
      <NuxtLink :to="departmentTo(row.original.id)" class="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ row.original.name }}</NuxtLink>
      <span class="ms-2 text-xs tabular-nums text-muted">{{ row.original.employee_count }}</span>
    </template>
    <template #manager-cell="{ row }">
      <div v-if="row.original.manager" class="flex min-w-0 items-center gap-1.5">
        <UAvatar v-bind="avatarProps(row.original.manager.name, row.original.manager.id)" size="2xs" />
        <span class="truncate">{{ row.original.manager.name }}</span>
      </div>
      <span v-else class="text-xs text-dimmed">{{ t('hr.depts.noManager') }}</span>
    </template>
    <template #actions-cell="{ row }">
      <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('hr.depts.rowActions', { name: row.original.name })" /></div>
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <NuxtLink :to="departmentTo(row.id)" class="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ row.name }}</NuxtLink><span class="ms-2 text-muted">{{ row.employee_count }}</span>
        </div>
        <SharedRowActions v-if="canManage" :actions="actionsFor(row)" :label="t('hr.depts.rowActions', { name: row.name })" />
      </div>
      <p class="mt-2 text-xs" :class="row.manager ? 'text-muted' : 'text-dimmed'">{{ row.manager?.name || t('hr.depts.noManager') }}</p>
    </template>
  </SharedDataTable>
</template>
