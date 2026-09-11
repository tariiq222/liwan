<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import EmptyState from '@/components/shared/EmptyState.vue'
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import { budgetStatus, formatNullableAmount, formatNullableCount, formatNullablePercent } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'
import RecordNumber from '@/components/shared/RecordNumber.vue'

const props = defineProps<{
  items: ProjectReportRow[]
  isLoading: boolean
  filtered: boolean
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const compactRecords = ref(false)
const loading = computed(() => props.isLoading || !hydrated.value)
const unknown = computed(() => t('projects.finance.unknown'))
const unavailable = computed(() => t('projects.reports.unavailable'))
const columns = computed(() => [
  { id: 'record', header: t('app.recordNumber') },
  { id: 'project', header: t('projects.reports.columns.project') },
  { id: 'status', header: t('projects.reports.columns.status') },
  { id: 'estimate', header: t('projects.reports.columns.estimate') },
  { id: 'planned', header: t('projects.finance.planned') },
  { id: 'actual', header: t('projects.finance.actual') },
  { id: 'remaining', header: t('projects.finance.remaining') },
  { id: 'budget', header: t('projects.finance.overBudget') },
  { id: 'tasks', header: t('projects.reports.columns.tasks') },
  { id: 'progress', header: t('projects.reports.columns.progress') },
])

onMounted(() => {
  const query = window.matchMedia('(max-width: 767px)')
  const sync = () => { compactRecords.value = query.matches }
  sync()
  query.addEventListener('change', sync)
  onUnmounted(() => query.removeEventListener('change', sync))
})

function budgetBadge(row: ProjectReportRow) {
  return budgetStatus(row.finance)
}
</script>

<template>
  <div class="rounded-xl border border-default overflow-hidden">
    <UTable
      v-if="!compactRecords"
      :data="loading ? [] : items"
      :columns="columns"
      :loading="loading"
      :caption="t('projects.reports.columns.project')"
      :ui="{ caption: 'sr-only' }"
    >
      <template #loading>
        <div class="grid gap-3 p-4" role="status" :aria-label="$t('app.loading')">
          <USkeleton v-for="n in 5" :key="n" class="h-5 w-full" />
        </div>
      </template>
      <template #empty>
        <EmptyState
          :title="t(filtered ? 'projects.reports.filteredEmpty' : 'projects.reports.empty')"
          :description="t(filtered ? 'projects.reports.filteredEmptyHint' : 'projects.reports.emptyHint')"
        />
      </template>
      <template #record-cell="{ row }">
        <div data-testid="reports-row">
          <RecordNumber :value="row.original.project.id" />
          <span class="sr-only">{{ formatNullablePercent(row.original.progress, unavailable) }}</span>
        </div>
      </template>
      <template #project-cell="{ row }">
        <UButton
          color="neutral"
          variant="link"
          class="block truncate p-0 font-medium text-start"
          :to="{ path: `/projects/${row.original.project.id}/finance`, query: returnToQuery(route.fullPath) }"
        >
          {{ row.original.project.name }}
        </UButton>
      </template>
      <template #status-cell="{ row }">
        <ProjectStatusBadge :status="row.original.project.status" />
      </template>
      <template #estimate-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.original.finance.charter_estimate, row.original.finance.currency, unknown) }}</span></template>
      <template #planned-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.original.finance.planned, row.original.finance.currency, unknown) }}</span></template>
      <template #actual-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.original.finance.actual, row.original.finance.currency, unknown) }}</span></template>
      <template #remaining-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.original.finance.remaining, row.original.finance.currency, unknown) }}</span></template>
      <template #budget-cell="{ row }">
        <UBadge v-if="budgetBadge(row.original) === 'unknown'" color="neutral" variant="outline">{{ t('projects.finance.budgetUnknown') }}</UBadge>
        <UBadge v-else-if="budgetBadge(row.original) === 'over'" color="error" variant="subtle">{{ t('projects.finance.overBudget') }}</UBadge>
        <span v-else class="text-muted">{{ t('projects.finance.onBudget') }}</span>
      </template>
      <template #tasks-cell="{ row }">
        <span class="text-sm">
          <span class="tabular-nums">{{ formatNullableCount(row.original.task_count, unavailable) }}</span>
          <span class="block text-xs text-muted">
            {{ t('projects.reports.closedOf', { closed: formatNullableCount(row.original.closed_task_count, unavailable), overdue: formatNullableCount(row.original.overdue_task_count, unavailable) }) }}
          </span>
        </span>
      </template>
      <template #progress-cell="{ row }"><span class="tabular-nums">{{ formatNullablePercent(row.original.progress, unavailable) }}</span></template>
    </UTable>

    <div v-else>
      <div v-if="loading" class="grid gap-4 p-4" role="status" :aria-label="$t('app.loading')">
        <USkeleton v-for="n in 5" :key="n" class="h-28 w-full" />
      </div>
      <EmptyState
        v-else-if="items.length === 0"
        :title="t(filtered ? 'projects.reports.filteredEmpty' : 'projects.reports.empty')"
        :description="t(filtered ? 'projects.reports.filteredEmptyHint' : 'projects.reports.emptyHint')"
      />
      <ul v-else class="grid divide-y divide-default" :aria-label="t('projects.reports.columns.project')">
        <li v-for="row in items" :key="row.project.id" class="grid gap-3 p-4" data-testid="reports-row">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <RecordNumber :value="row.project.id" />
              <UButton
                color="neutral"
                variant="link"
                class="mt-1 block p-0 text-start font-medium whitespace-normal"
                :to="{ path: `/projects/${row.project.id}/finance`, query: returnToQuery(route.fullPath) }"
              >
                {{ row.project.name }}
              </UButton>
            </div>
            <ProjectStatusBadge :status="row.project.status" />
          </div>
          <dl class="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt class="text-muted">{{ t('projects.reports.columns.estimate') }}</dt>
              <dd dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.charter_estimate, row.finance.currency, unknown) }}</dd>
            </div>
            <div>
              <dt class="text-muted">{{ t('projects.finance.planned') }}</dt>
              <dd dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.planned, row.finance.currency, unknown) }}</dd>
            </div>
            <div>
              <dt class="text-muted">{{ t('projects.finance.actual') }}</dt>
              <dd dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.actual, row.finance.currency, unknown) }}</dd>
            </div>
            <div>
              <dt class="text-muted">{{ t('projects.finance.remaining') }}</dt>
              <dd dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.remaining, row.finance.currency, unknown) }}</dd>
            </div>
            <div>
              <dt class="text-muted">{{ t('projects.finance.overBudget') }}</dt>
              <dd>
                <UBadge v-if="budgetBadge(row) === 'unknown'" color="neutral" variant="outline">{{ t('projects.finance.budgetUnknown') }}</UBadge>
                <UBadge v-else-if="budgetBadge(row) === 'over'" color="error" variant="subtle">{{ t('projects.finance.overBudget') }}</UBadge>
                <span v-else class="text-muted">{{ t('projects.finance.onBudget') }}</span>
              </dd>
            </div>
            <div>
              <dt class="text-muted">{{ t('projects.reports.columns.progress') }}</dt>
              <dd class="tabular-nums">{{ formatNullablePercent(row.progress, unavailable) }}</dd>
            </div>
            <div class="col-span-2">
              <dt class="text-muted">{{ t('projects.reports.columns.tasks') }}</dt>
              <dd>
                <span class="tabular-nums">{{ formatNullableCount(row.task_count, unavailable) }}</span>
                <span class="block text-muted">
                  {{ t('projects.reports.closedOf', { closed: formatNullableCount(row.closed_task_count, unavailable), overdue: formatNullableCount(row.overdue_task_count, unavailable) }) }}
                </span>
              </dd>
            </div>
          </dl>
        </li>
      </ul>
    </div>
  </div>
</template>
