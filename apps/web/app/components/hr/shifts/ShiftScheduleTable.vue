<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import type { HrShiftSchedule } from '@/composables/useHrShifts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'

// The schedule list of /hr/shifts/schedules on SharedDataTable. A row opens its schedule
// record page and carries the list state in returnTo; archiving is handed to the page,
// which owns the inline confirmation.
const props = defineProps<{
  schedules: HrShiftSchedule[]
  caption: string
  loading?: boolean
  error?: unknown
  canManage?: boolean
}>()
const emit = defineEmits<{ archive: [schedule: HrShiftSchedule]; retry: [] }>()
const route = useRoute()
const { t, n } = useI18n()

const columns = computed<TableColumn<HrShiftSchedule>[]>(() => [
  { accessorKey: 'name', header: t('hrShifts.columns.name'), meta: { class: { td: 'font-semibold text-highlighted' } } },
  { accessorKey: 'tz', header: t('hrShifts.columns.tz') },
  { accessorKey: 'hours_per_week', header: t('hrShifts.columns.hoursPerWeek') },
  { accessorKey: 'attendances', header: t('hrShifts.columns.attendances') },
  { accessorKey: 'active', header: t('hrShifts.columns.state') },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-12', td: 'w-12 text-end' } } },
])

function scheduleTo(schedule: HrShiftSchedule) {
  return { path: `/hr/shifts/schedules/${schedule.id}`, query: returnToQuery(route.fullPath) }
}

function actions(schedule: HrShiftSchedule): RowAction[] {
  if (!props.canManage || !schedule.active) return []
  return [{
    label: t('hrShifts.archive'),
    icon: 'i-lucide-archive',
    destructive: true,
    onSelect: () => emit('archive', schedule),
  }]
}
</script>

<template>
  <SharedDataTable
    bare
    :rows="props.schedules"
    :columns="columns"
    row-key="id"
    :row-to="scheduleTo"
    :loading="props.loading"
    :error="props.error"
    :caption="props.caption"
    @retry="emit('retry')"
  >
    <template #name-cell="{ row }">{{ row.original.name }}</template>
    <template #tz-cell="{ row }"><bdi>{{ row.original.tz || 'UTC' }}</bdi></template>
    <template #hours_per_week-cell="{ row }"><span class="tabular-nums">{{ n(row.original.hours_per_week) }}</span></template>
    <template #attendances-cell="{ row }">{{ t('hrShifts.lines', { count: row.original.attendances.length }, row.original.attendances.length) }}</template>
    <template #active-cell="{ row }">
      <SharedStatusBadge
        size="sm"
        :tone="row.original.active ? 'success' : 'neutral'"
        :label="row.original.active ? t('hrShifts.stateActive') : t('hrShifts.stateArchived')"
        data-testid="hr-shift-schedule-state"
      />
    </template>
    <template #actions-cell="{ row }">
      <SharedRowActions :actions="actions(row.original)" :label="t('hrShifts.actionsForSchedule', { name: row.original.name })" />
    </template>
    <template #mobile-row="{ row }">
      <p class="font-semibold text-highlighted">{{ row.name }}</p>
      <p class="mt-1 text-xs text-muted">
        <bdi>{{ row.tz || 'UTC' }}</bdi> · <span class="tabular-nums">{{ n(row.hours_per_week) }}</span>
        · {{ t('hrShifts.lines', { count: row.attendances.length }, row.attendances.length) }}
      </p>
      <div class="mt-2 flex items-center justify-between gap-2">
        <SharedStatusBadge size="sm" :tone="row.active ? 'success' : 'neutral'" :label="row.active ? t('hrShifts.stateActive') : t('hrShifts.stateArchived')" />
        <SharedRowActions :actions="actions(row)" :label="t('hrShifts.actionsForSchedule', { name: row.name })" />
      </div>
    </template>
  </SharedDataTable>
</template>
