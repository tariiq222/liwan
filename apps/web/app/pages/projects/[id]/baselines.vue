<script setup lang="ts">
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { useBaselineVariance, useProjectBaselines } from '@/composables/useProjectBaselines'
import { useGovernancePaging } from '@/components/pmo/projects/governance/listPaging'
import BaselineTakePanel from '@/components/pmo/projects/baselines/BaselineTakePanel.vue'
import BaselineVarianceSummary from '@/components/pmo/projects/baselines/BaselineVarianceSummary.vue'
import BaselineVarianceTable from '@/components/pmo/projects/baselines/BaselineVarianceTable.vue'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { useProjectMissing } from '@/composables/useProjects'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'
import { formatMoney } from '@/utils/projectFinance'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const isListRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === `/projects/${route.params.id}/baselines`)
const offset = computed(() => {
  const raw = typeof route.query.offset === 'string' && /^\d+$/.test(route.query.offset) ? Number(route.query.offset) : 0
  return Number.isSafeInteger(raw) ? raw : 0
})
const list = useProjectBaselines(computed(() => isListRoute.value ? id.value : null), offset)
const variance = useBaselineVariance(computed(() => isListRoute.value ? id.value : null))
const notFound = useProjectMissing(id)
const { pageNumber, pages, setPage } = useGovernancePaging(list, offset, isListRoute, { route, router, hydrated })

// A link out of the list carries the list's own state, so Back returns to the same page.
const liveQuery = computed(() => {
  const { returnTo: _referrer, ...rest } = route.query
  return rest
})
const itemTo = (item: { number: number }) => ({ path: `/projects/${id.value}/baselines/${item.number}`, query: liveQuery.value })
const columns = computed(() => [
  { accessorKey: 'number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12 px-2', td: 'w-12 px-2' } } },
  { id: 'taken', header: t('projects.baselines.fields.takenAt'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
  { id: 'by', header: t('projects.baselines.fields.takenBy'), meta: { class: { th: 'w-28', td: 'w-28' } } },
  { id: 'dates', header: t('projects.baselines.fields.plannedDates'), meta: { class: { th: 'w-52', td: 'w-52 whitespace-nowrap' } } },
  { id: 'budget', header: t('projects.baselines.fields.budget'), meta: { class: { th: 'w-36 text-end', td: 'w-36 text-end whitespace-nowrap' } } },
  { accessorKey: 'task_count', header: t('projects.baselines.fields.tasks'), meta: { class: { th: 'w-20', td: 'w-20 tabular-nums' } } },
  { id: 'note', header: t('projects.baselines.fields.note'), meta: { class: { th: 'min-w-40', td: 'max-w-0 min-w-40 truncate' } } },
])
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const dates = (item: { planned_start: string | null; planned_end: string | null }) => item.planned_start || item.planned_end ? `${item.planned_start ?? '—'} → ${item.planned_end ?? '—'}` : '—'
const money = (item: { budget_total: number; currency: Parameters<typeof formatMoney>[1] | null }) => item.currency ? formatMoney(item.budget_total, item.currency) : String(item.budget_total)
const empty = computed(() => Boolean(list.data.value) && !items.value.length && !offset.value)
</script>

<template>
  <ProjectNotFoundState v-if="isListRoute && notFound" />
  <SharedListPage v-else-if="isListRoute" hide-header :title="t('projects.baselines.title')">
    <SharedPageState v-if="list.error.value" :error="list.error.value" @retry="list.refetch" />
    <template v-else>
      <BaselineTakePanel v-if="list.data.value" :project-id="id" :list="list.data.value" />
      <SharedEmptyState v-if="empty" bordered :title="t('projects.baselines.empty')" :description="t('projects.baselines.emptyHint')" />
      <template v-else>
        <BaselineVarianceSummary v-if="variance.data.value" :variance="variance.data.value" />
        <SharedListCard>
          <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="itemTo" :loading="list.isLoading.value" :caption="t('projects.baselines.title')">
            <template #number-cell="{ row }"><RecordNumber :value="row.original.number" /></template>
            <template #taken-cell="{ row }">{{ formatLiwanDate(row.original.taken_at) }}</template>
            <template #by-cell="{ row }"><SharedPersonAvatar :people="[row.original.taken_by]" /></template>
            <template #dates-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ dates(row.original) }}</span></template>
            <template #budget-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ money(row.original) }}</span></template>
            <template #note-cell="{ row }">
              <NuxtLink :to="itemTo(row.original)" class="block truncate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.note || t('projects.baselines.openBaseline', { number: row.original.number }) }}</NuxtLink>
            </template>
            <template #mobile-row="{ row: item }">
              <div class="space-y-2">
                <div class="flex items-start justify-between gap-3">
                  <RecordNumber :value="item.number" />
                  <span class="text-xs text-muted">{{ formatLiwanDate(item.taken_at) }}</span>
                </div>
                <NuxtLink :to="itemTo(item)" class="block font-semibold text-highlighted hover:underline">{{ item.note || t('projects.baselines.openBaseline', { number: item.number }) }}</NuxtLink>
                <dl class="grid grid-cols-2 gap-x-3 text-sm">
                  <div><dt class="text-xs text-muted">{{ t('projects.baselines.fields.budget') }}</dt><dd dir="ltr" class="tabular-nums">{{ money(item) }}</dd></div>
                  <div><dt class="text-xs text-muted">{{ t('projects.baselines.fields.tasks') }}</dt><dd class="tabular-nums">{{ item.task_count }}</dd></div>
                </dl>
              </div>
            </template>
          </SharedDataTable>
          <template v-if="items.length" #footer>
            <SharedListFooter :count-label="t('projects.footer.results', { shown: items.length, total }, total)" count-test-id="baseline-result-count" :page="pageNumber" :pages="pages" :disabled="list.isFetching.value" @update:page="setPage" />
          </template>
        </SharedListCard>
        <SharedRecordSection v-if="variance.data.value?.schedule?.tasks.length" variant="panel" :title="t('projects.baselines.variance.tasksTitle')">
          <BaselineVarianceTable :rows="variance.data.value.schedule.tasks" :project-id="id" />
        </SharedRecordSection>
      </template>
    </template>
  </SharedListPage>
  <NuxtPage />
</template>
