<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
import RecordNumber from '@/components/shared/RecordNumber.vue'

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

function onSelectRow(_event: Event, row: { original: HrDepartment }) {
  if (hydrated.value) emit('select', row.original.id)
}
</script>

<template>
  <div class="min-w-0 space-y-2" data-testid="hr-department-table">
    <UCard class="rounded-lg ring ring-default bg-default overflow-hidden hidden md:block" :ui="{ body: 'p-0' }">
      <div v-if="!departments.length" class="p-6"><SharedEmptyState :title="t('hr.depts.empty')" /></div>
      <div v-else class="overflow-x-auto">
        <UTable :data="departments" :columns="columns" :caption="t('hr.depts.title')" :ui="{ caption: 'sr-only', th: '' }" @select="onSelectRow">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #name-cell="{ row }">
            <span class="font-medium">{{ row.original.name }}</span>
            <span class="ms-2 text-muted">{{ row.original.employee_count }}</span>
          </template>
          <template #manager-cell="{ row }">{{ row.original.manager?.name || t('hr.depts.noManager') }}</template>
          <template #actions-cell="{ row }">
            <div class="flex flex-wrap gap-1" @click.stop>
              <UButton color="primary" variant="ghost" size="sm" :disabled="!hydrated" :label="t('hr.depts.edit')" :to="{ path: `/hr/departments/${row.original.id}/edit`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()" />
              <UButton v-if="props.canDelete !== false" color="error" variant="ghost" size="sm" :disabled="!hydrated" :label="t('hr.depts.delete')" @click="emit('delete', row.original)" />
            </div>
          </template>
        </UTable>
      </div>
    </UCard>
    <div v-if="!departments.length" class="md:hidden"><SharedEmptyState :title="t('hr.depts.empty')" /></div>
    <ul v-else class="md:hidden space-y-2" :aria-label="t('hr.depts.title')">
      <li
        v-for="department in departments"
        :key="department.id"
        class="rounded-lg ring ring-default bg-default overflow-hidden p-4"
        :class="{ 'bg-elevated': selectedId === department.id }"
        tabindex="0"
        role="button"
        @click="hydrated && emit('select', department.id)" @keydown.enter.self="hydrated && emit('select', department.id)" @keydown.space.self.prevent="hydrated && emit('select', department.id)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <bdi class="block text-xs text-muted">#{{ department.id }}</bdi>
            <p class="font-medium">{{ department.name }}<span class="ms-2 text-muted">{{ department.employee_count }}</span></p>
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">{{ department.manager?.name || t('hr.depts.noManager') }}</p>
        <div v-if="canManage" class="mt-3 flex flex-wrap gap-2" @click.stop>
          <UButton color="primary" variant="ghost" size="sm" :disabled="!hydrated" :label="t('hr.depts.edit')" :to="{ path: `/hr/departments/${department.id}/edit`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()" />
          <UButton v-if="props.canDelete !== false" color="error" variant="ghost" size="sm" :disabled="!hydrated" :label="t('hr.depts.delete')" @click="emit('delete', department)" />
        </div>
      </li>
    </ul>
  </div>
</template>
