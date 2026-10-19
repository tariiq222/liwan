<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { HrActivityPlan } from '@webvue/contracts'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

// The plans list of one lifecycle area on SharedDataTable. Deactivation is handed to the
// page, which owns the inline confirmation.
const props = withDefaults(defineProps<{
  plans: HrActivityPlan[]
  namespace: string
  toFor: (row: HrActivityPlan) => RouteLocationRaw
  canManage?: boolean
}>(), { canManage: false })
const emit = defineEmits<{ toggle: [plan: HrActivityPlan] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const WIDTH = {
  name: 'min-w-[240px]',
  department: 'w-[160px] min-w-[160px]',
  steps: 'w-[104px] min-w-[104px]',
  active: 'w-[120px] min-w-[120px]',
  actions: 'w-[56px] min-w-[56px]',
}
const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

function column(id: string, header: string, width: string, fit = true): TableColumn<HrActivityPlan> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<HrActivityPlan>['meta'] }
}
const columns = computed<TableColumn<HrActivityPlan>[]>(() => [
  column('name', t(`${props.namespace}.form.name`), WIDTH.name, false),
  column('department', t(`${props.namespace}.form.department`), WIDTH.department),
  column('steps', t(`${props.namespace}.plans.steps`), WIDTH.steps),
  column('active', t(`${props.namespace}.form.active`), WIDTH.active),
  ...(props.canManage ? [column('actions', t(`${props.namespace}.actions.edit`), WIDTH.actions)] : []),
])
function actionsFor(plan: HrActivityPlan): RowAction[] {
  return [
    { label: t(`${props.namespace}.actions.edit`), icon: 'i-lucide-pencil', to: toFor(plan) },
    {
      label: plan.active ? t(`${props.namespace}.plans.deactivate`) : t(`${props.namespace}.plans.activate`),
      icon: plan.active ? 'i-lucide-circle-slash' : 'i-lucide-circle-check',
      destructive: plan.active,
      onSelect: () => emit('toggle', plan),
    },
  ]
}
</script>

<template>
  <div class="webvue-fixed-table min-w-0">
    <SharedDataTable
      bare
      data-testid="hr-lifecycle-plan-table"
      :rows="plans"
      :columns="columns"
      row-key="id"
      :row-to="planTo"
      :empty-text="t(`${namespace}.plans.empty`)"
      :caption="t(`${namespace}.plans.title`)"
    >
      <template #name-cell="{ row }">
        <NuxtLink :to="toFor(row.original)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.original.name }}</NuxtLink>
      </template>
      <template #department-cell="{ row }">
        <span class="truncate text-muted">{{ row.original.department?.name || t(`${namespace}.form.anyDepartment`) }}</span>
      </template>
      <template #steps-cell="{ row }"><span class="tabular-nums text-muted">{{ row.original.steps.length }}</span></template>
      <template #active-cell="{ row }">
        <SharedStatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="row.original.active ? t(`${namespace}.form.active`) : t(`${namespace}.plans.activate`)" />
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t(`${namespace}.actions.edit`)" /></div>
      </template>
      <template #mobile-row="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <NuxtLink :to="toFor(row)" :class="NAME_LINK" @click="!hydrated && $event.preventDefault()">{{ row.name }}</NuxtLink>
            <p class="mt-1 truncate text-xs text-muted">{{ row.department?.name || t(`${namespace}.form.anyDepartment`) }} · {{ row.steps.length }}</p>
          </div>
          <SharedRowActions v-if="canManage" :actions="actionsFor(row)" :label="t(`${namespace}.actions.edit`)" />
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
