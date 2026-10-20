<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import type { HrShiftAssignment } from '@/composables/useHrShifts'

// The assignment list of /hr/shifts on SharedDataTable. Ending an assignment is handed to
// the page, which owns the inline confirmation; an open end of a range is shown as such.
const props = defineProps<{
  assignments: HrShiftAssignment[]
  caption: string
  loading?: boolean
  error?: unknown
  canManage?: boolean
}>()
const emit = defineEmits<{ remove: [assignment: HrShiftAssignment]; retry: [] }>()
const { t } = useI18n()

const columns = computed<TableColumn<HrShiftAssignment>[]>(() => [
  { accessorKey: 'employee', header: t('hrShifts.columns.employee'), meta: { class: { td: 'font-semibold text-highlighted' } } },
  { accessorKey: 'schedule', header: t('hrShifts.columns.schedule') },
  { accessorKey: 'date_start', header: t('hrShifts.columns.period') },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-12', td: 'w-12 text-end' } } },
])

function period(assignment: HrShiftAssignment) {
  if (assignment.date_start && assignment.date_end) {
    return t('hrShifts.range', { from: assignment.date_start, to: assignment.date_end })
  }
  if (assignment.date_start) return t('hrShifts.rangeFrom', { from: assignment.date_start })
  if (assignment.date_end) return t('hrShifts.rangeUntil', { to: assignment.date_end })
  return t('hrShifts.rangeOpen')
}

function actions(assignment: HrShiftAssignment): RowAction[] {
  if (!props.canManage) return []
  return [{
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
    :loading="props.loading"
    :error="props.error"
    :caption="props.caption"
    @retry="emit('retry')"
  >
    <template #employee-cell="{ row }">{{ row.original.employee.name }}</template>
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
