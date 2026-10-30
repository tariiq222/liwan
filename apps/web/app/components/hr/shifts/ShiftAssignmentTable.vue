<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import type { HrShiftAssignment } from '@/composables/useHrShifts'

// The assignment list of /hr/shifts (and of the employee's own schedule) on SharedDataTable.
// On /hr/shifts a row opens the assignment's own page (`rowTo`), where it is edited; removing is handed to the page, which owns the inline
// confirmation. An open end of a range is shown as such.
const props = defineProps<{
  assignments: HrShiftAssignment[]
  caption: string
  loading?: boolean
  error?: unknown
  canManage?: boolean
  rowTo?: (assignment: HrShiftAssignment) => RouteLocationRaw
}>()
const emit = defineEmits<{ remove: [assignment: HrShiftAssignment]; retry: [] }>()
const { t } = useI18n()

const columns = computed<TableColumn<HrShiftAssignment>[]>(() => [
  { accessorKey: 'employee', header: t('hrShifts.columns.employee'), meta: { class: { td: 'font-semibold text-highlighted' } } },
  { accessorKey: 'schedule', header: t('hrShifts.columns.schedule') },
  { accessorKey: 'date_start', header: t('hrShifts.columns.period') },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-12', td: 'w-12 text-end' } } },
])

const period = useHrShiftPeriod()

function actions(assignment: HrShiftAssignment): RowAction[] {
  if (!props.canManage || !props.rowTo) return []
  return [{
    label: t('hrShifts.editAssignment'),
    icon: 'i-lucide-pencil',
    to: props.rowTo(assignment),
  }, {
    label: t('hrShifts.remove'),
    icon: 'i-lucide-trash-2',
    destructive: true,
    onSelect: () => emit('remove', assignment),
  }]
}
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.assignments"
    :columns="columns"
    row-key="id"
    :row-to="props.rowTo"
    :loading="props.loading"
    :error="props.error"
    :caption="props.caption"
    @retry="emit('retry')"
  >
    <template #employee-cell="{ row }">
      <NuxtLink v-if="props.rowTo" :to="props.rowTo(row.original)" class="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.employee.name }}</NuxtLink>
      <template v-else>{{ row.original.employee.name }}</template>
    </template>
    <template #schedule-cell="{ row }">{{ row.original.schedule.name }}</template>
    <template #date_start-cell="{ row }"><bdi class="tabular-nums">{{ period(row.original) }}</bdi></template>
    <template #actions-cell="{ row }">
      <SharedRowActions :actions="actions(row.original)" :label="t('hrShifts.actionsFor', { name: row.original.employee.name })" />
    </template>
    <template #mobile-row="{ row }">
      <p class="font-semibold text-highlighted">{{ row.employee.name }}</p>
      <p class="mt-1 text-sm">{{ row.schedule.name }}</p>
      <bdi class="block text-xs text-muted tabular-nums">{{ period(row) }}</bdi>
      <div v-if="canManage" class="mt-2 flex justify-end">
        <SharedRowActions :actions="actions(row)" :label="t('hrShifts.actionsFor', { name: row.employee.name })" />
      </div>
    </template>
  </SharedDataTable>
</template>
