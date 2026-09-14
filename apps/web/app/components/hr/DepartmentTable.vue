<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import type { RowAction } from '@/components/shared/RowActions.vue'

const props = defineProps<{
  departments: HrDepartment[]
  selectedId?: number | null
  canManage?: boolean
  canDelete?: boolean
}>()
const emit = defineEmits<{ select: [id: number]; edit: [department: HrDepartment]; delete: [department: HrDepartment] }>()
const hydrated = useHydrated()
const { can } = useAccess()
const route = useRoute()
const { t } = useI18n()
const canManage = computed(() => !!props.canManage && can('hr.departments.manage'))

const columns = computed<TableColumn<HrDepartment>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('hr.depts.name') },
  { accessorKey: 'manager', header: t('hr.depts.manager') },
  ...(canManage.value ? [{ accessorKey: 'actions', header: t('hr.directory.columns.actions') } as TableColumn<HrDepartment>] : []),
])

function onSelectRow(event: Event, row: { original: HrDepartment }) {
  if (!hydrated.value || (event.target as HTMLElement | null)?.closest('a, button')) return
  emit('select', row.original.id)
}
function departmentTo(id: number) {
  return { path: `/hr/departments/${id}`, query: returnToQuery(route.fullPath) }
}
function actionsFor(department: HrDepartment): RowAction[] {
  return [
    { label: t('hr.depts.edit'), icon: 'i-lucide-pencil', to: { path: `/hr/departments/${department.id}/edit`, query: returnToQuery(route.fullPath) } },
    ...(props.canDelete !== false ? [{ label: t('hr.depts.delete'), icon: 'i-lucide-trash-2', destructive: true, onSelect: () => emit('delete', department) } satisfies RowAction] : []),
  ]
}
</script>

<template>
  <div class="min-w-0 space-y-2" data-testid="hr-department-table">
    <div class="hidden overflow-hidden rounded-lg bg-default ring ring-default md:block">
      <div v-if="!departments.length" class="p-6"><SharedEmptyState :title="t('hr.depts.empty')" /></div>
      <div v-else class="overflow-x-auto">
        <UTable :data="departments" :columns="columns" :caption="t('hr.depts.title')" :ui="{ caption: 'sr-only', th: '', tr: 'cursor-pointer' }" @select="onSelectRow">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #name-cell="{ row }">
            <NuxtLink :to="departmentTo(row.original.id)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ row.original.name }}</NuxtLink>
            <span class="ms-2 text-muted">{{ row.original.employee_count }}</span>
          </template>
          <template #manager-cell="{ row }">{{ row.original.manager?.name || t('hr.depts.noManager') }}</template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('hr.depts.rowActions', { name: row.original.name })" /></div>
          </template>
        </UTable>
      </div>
    </div>
    <div v-if="!departments.length" class="md:hidden"><SharedEmptyState :title="t('hr.depts.empty')" /></div>
    <ul v-else class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default md:hidden" :aria-label="t('hr.depts.title')">
      <li
        v-for="department in departments"
        :key="department.id"
        class="p-4"
        :class="{ 'bg-elevated': selectedId === department.id }"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <bdi class="block text-xs text-muted">#{{ department.id }}</bdi>
            <NuxtLink :to="departmentTo(department.id)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ department.name }}</NuxtLink><span class="ms-2 text-muted">{{ department.employee_count }}</span>
          </div>
          <SharedRowActions v-if="canManage" :actions="actionsFor(department)" :label="t('hr.depts.rowActions', { name: department.name })" />
        </div>
        <p class="mt-2 text-xs text-muted">{{ department.manager?.name || t('hr.depts.noManager') }}</p>
      </li>
    </ul>
  </div>
</template>
