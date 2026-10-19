<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrPlanRun } from '@webvue/contracts'

// The runs list of one lifecycle area: the employee, its plan, when it started and how
// many steps are done.
const props = defineProps<{
  runs: HrPlanRun[]
  namespace: string
  toFor: (run: HrPlanRun) => { path: string; query?: Record<string, unknown> }
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const WIDTH = {
  employee: 'min-w-[200px]',
  plan: 'min-w-[200px]',
  date: 'w-[128px] min-w-[128px]',
  progress: 'w-[120px] min-w-[120px]',
  state: 'w-[120px] min-w-[120px]',
}
const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

function column(id: string, header: string, width: string, fit = true): TableColumn<HrPlanRun> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<HrPlanRun>['meta'] }
}
const columns = computed<TableColumn<HrPlanRun>[]>(() => [
  column('employee', t(`${props.namespace}.runs.employee`), WIDTH.employee, false),
  column('plan', t(`${props.namespace}.runs.plan`), WIDTH.plan, false),
  column('date', t(`${props.namespace}.runs.planDate`), WIDTH.date),
  column('progress', t(`${props.namespace}.runs.progress`), WIDTH.progress),
  column('state', t(`${props.namespace}.runs.state`), WIDTH.state),
])
function runTo(run: HrPlanRun) {
  return { path: props.toFor(run).path, query: props.toFor(run).query ?? {} }
}
function stateTone(run: HrPlanRun) {
  return run.state === 'done' ? 'success' : 'info'
}
</script>

<template>
  <div class="webvue-fixed-table min-w-0">
    <SharedDataTable
      bare
      data-testid="hr-lifecycle-run-table"
      :rows="runs"
      :columns="columns"
      row-key="id"
      :row-to="runTo"
      :empty-text="t(`${namespace}.runs.empty`)"
      :caption="t(`${namespace}.runs.title`)"
    >
      <template #employee-cell="{ row }">
        <NuxtLink :to="runTo(row.original)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.original.employee.name }}</NuxtLink>
      </template>
      <template #plan-cell="{ row }"><span class="truncate text-muted">{{ row.original.plan.name }}</span></template>
      <template #date-cell="{ row }"><span class="tabular-nums text-muted">{{ row.original.plan_date }}</span></template>
      <template #progress-cell="{ row }">
        <span class="tabular-nums text-muted">{{ row.original.done }} / {{ row.original.total }}</span>
      </template>
      <template #state-cell="{ row }">
        <SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="t(`${namespace}.states.${row.original.state}`)" />
      </template>
      <template #mobile-row="{ row }">
        <div class="min-w-0">
          <NuxtLink :to="runTo(row)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.employee.name }}</NuxtLink>
          <p class="mt-1 truncate text-xs text-muted">{{ row.plan.name }} · {{ row.done }} / {{ row.total }}</p>
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
