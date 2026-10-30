<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrDeparture } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'

// The departure register on SharedDataTable: who is leaving, when, and how far their
// clearance checklist has come.
const props = defineProps<{
  departures: HrDeparture[]
  namespace: string
  toFor: (row: HrDeparture) => RouteLocationRaw
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const WIDTH = {
  employee: 'min-w-[200px]',
  date: 'w-[128px] min-w-[128px]',
  reason: 'min-w-[160px]',
  clearance: 'w-[128px] min-w-[128px]',
  active: 'w-[148px] min-w-[148px]',
  actions: 'w-[56px] min-w-[56px]',
}
const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

function column(id: string, header: string, width: string, fit = true): TableColumn<HrDeparture> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<HrDeparture>['meta'] }
}
const columns = computed<TableColumn<HrDeparture>[]>(() => [
  column('employee', t(`${props.namespace}.departures.employee`), WIDTH.employee, false),
  column('date', t(`${props.namespace}.departures.date`), WIDTH.date),
  column('reason', t(`${props.namespace}.departures.reason`), WIDTH.reason, false),
  column('clearance', t(`${props.namespace}.departures.clearance`), WIDTH.clearance),
  column('active', t(`${props.namespace}.departures.active`), WIDTH.active),
  column('actions', t(`${props.namespace}.actions.edit`), WIDTH.actions),
])
function departureKey(departure: HrDeparture) {
  return departure.employee.id
}
function cleared(departure: HrDeparture) {
  return departure.clearance.total > 0 && departure.clearance.done === departure.clearance.total
}
function actionsFor(departure: HrDeparture): RowAction[] {
  return [{ label: t(`${props.namespace}.actions.edit`), icon: 'i-lucide-pencil', to: props.toFor(departure) }]
}
</script>

<template>
  <div class="liwan-fixed-table min-w-0">
    <SharedDataTable
      bare
      data-testid="hr-departure-table"
      :rows="departures"
      :columns="columns"
      :row-key="departureKey"
      :row-to="toFor"
      :empty-text="t(`${namespace}.departures.empty`)"
      :caption="t(`${namespace}.departures.title`)"
    >
      <template #employee-cell="{ row }">
        <NuxtLink :to="toFor(row.original)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.original.employee.name }}</NuxtLink>
      </template>
      <template #date-cell="{ row }"><span class="tabular-nums text-muted">{{ row.original.departure_date }}</span></template>
      <template #reason-cell="{ row }"><span class="truncate text-muted">{{ row.original.reason?.name || t(`${namespace}.departures.noReason`) }}</span></template>
      <template #clearance-cell="{ row }">
        <SharedStatusBadge
          size="sm"
          :tone="cleared(row.original) ? 'success' : 'warning'"
          :label="cleared(row.original) ? t(`${namespace}.departures.cleared`) : t(`${namespace}.departures.notCleared`)"
        />
      </template>
      <template #active-cell="{ row }">
        <SharedStatusBadge size="sm" tone="neutral" :label="row.original.active ? t(`${namespace}.departures.active`) : t(`${namespace}.departures.archived`)" />
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t(`${namespace}.actions.openDeparture`)" /></div>
      </template>
      <template #mobile-row="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <NuxtLink :to="toFor(row)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.employee.name }}</NuxtLink>
            <p class="mt-1 truncate text-xs text-muted">{{ row.departure_date }} · {{ row.reason?.name || t(`${namespace}.form.noClearancePlan`) }}</p>
          </div>
          <SharedStatusBadge size="sm" :tone="cleared(row) ? 'success' : 'warning'" :label="cleared(row) ? t(`${namespace}.departures.cleared`) : t(`${namespace}.departures.notCleared`)" />
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
