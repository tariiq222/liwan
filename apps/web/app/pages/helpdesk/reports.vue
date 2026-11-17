<script setup lang="ts">
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { useHelpdeskReport } from '@/composables/helpdesk/useHelpdeskReport'

// The reports page of the desk: the period in the URL, the four figures that answer "are we meeting what we promised",
// then each agent's load and the tickets per stage. A zero target in the settings disables its measure instead of
// pretending a perfect score.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const period = computed(() => {
  const value = route.query.period
  return typeof value === 'string' && ['7', '30', '90', '365'].includes(value) ? value : '30'
})
const report = useHelpdeskReport(period)
const data = computed(() => report.data.value ?? null)
const periodItems = computed(() => (data.value?.periods ?? []).map(row => ({ value: row.value, label: t(`helpdesk.reports.period.${row.value}`) })))

const kpis = computed<KpiTile[]>(() => {
  const kpisValue = data.value?.kpis
  if (!kpisValue) return []
  return [
    {
      id: 'first-response', label: t('helpdesk.reports.firstResponse'), icon: 'i-lucide-timer',
      value: kpisValue.first_response_hours === null ? null : t('helpdesk.reports.hours', { count: kpisValue.first_response_hours }),
      hint: kpisValue.first_response_target ? t('helpdesk.reports.target', { count: kpisValue.first_response_target }) : t('helpdesk.reports.noTarget'),
      tone: kpisValue.first_response_target && kpisValue.first_response_hours !== null
        && kpisValue.first_response_hours > kpisValue.first_response_target ? 'danger' : 'neutral',
    },
    {
      id: 'resolution', label: t('helpdesk.reports.resolution'), icon: 'i-lucide-circle-check',
      value: kpisValue.resolution_hours === null ? null : t('helpdesk.reports.hours', { count: kpisValue.resolution_hours }),
      hint: kpisValue.resolution_target ? t('helpdesk.reports.target', { count: kpisValue.resolution_target }) : t('helpdesk.reports.noTarget'),
      tone: kpisValue.resolution_target && kpisValue.resolution_hours !== null
        && kpisValue.resolution_hours > kpisValue.resolution_target ? 'danger' : 'neutral',
    },
    {
      id: 'sla', label: t('helpdesk.reports.sla'), icon: 'i-lucide-gauge',
      value: kpisValue.sla_compliance_percent === null ? null : `${kpisValue.sla_compliance_percent}%`,
      progress: kpisValue.sla_compliance_percent ?? undefined,
      hint: t('helpdesk.reports.slaHint', { met: kpisValue.sla_met, late: kpisValue.sla_late }),
      tone: kpisValue.sla_late ? 'warning' : 'success',
    },
    {
      id: 'open', label: t('helpdesk.reports.open'), icon: 'i-lucide-life-buoy', value: data.value?.open ?? 0,
      hint: t('helpdesk.reports.totalHint', { total: data.value?.total ?? 0 }), tone: 'neutral',
    },
  ]
})
function setPeriod(value: string) {
  void router.replace({ query: { ...route.query, period: value === '30' ? undefined : value } })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('helpdesk.reports.title')" :description="t('helpdesk.reports.subtitle')">
      <template #actions>
        <USelect :model-value="period" :items="periodItems" :aria-label="t('helpdesk.reports.periodLabel')" data-testid="helpdesk-report-period" @update:model-value="value => setPeriod(String(value))" />
      </template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!can('helpdesk.reports.read')" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="report.isLoading.value" :error="report.error.value" :empty="!data" @retry="report.refetch">
        <template v-if="data">
          <SharedKpiStrip :tiles="kpis" />
          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            <SharedListCard :title="t('helpdesk.reports.agents')" data-testid="helpdesk-report-agents">
              <SharedEmptyState v-if="!data.agents.length" :title="t('helpdesk.reports.empty')" />
              <SharedDataTable
                v-else
                bare
                :rows="data.agents"
                :columns="[
                  { id: 'name', header: t('helpdesk.reports.agent'), accessorKey: 'name' },
                  { id: 'open', header: t('helpdesk.reports.openShort'), accessorKey: 'open' },
                  { id: 'closed', header: t('helpdesk.reports.closedShort'), accessorKey: 'closed' },
                  { id: 'overdue', header: t('helpdesk.reports.overdueShort'), accessorKey: 'overdue' },
                  { id: 'first', header: t('helpdesk.reports.firstResponseShort'), accessorKey: 'first_response_hours' },
                ]"
                row-key="name"
                :caption="t('helpdesk.reports.agents')"
              >
                <template #name-cell="{ row }">{{ row.original.name || t('helpdesk.unassigned') }}</template>
                <template #first-cell="{ row }">
                  <bdi dir="ltr">{{ row.original.first_response_hours === null ? '—' : t('helpdesk.reports.hours', { count: row.original.first_response_hours }) }}</bdi>
                </template>
              </SharedDataTable>
            </SharedListCard>
            <SharedListCard :title="t('helpdesk.reports.byStage')" data-testid="helpdesk-report-stages">
              <SharedEmptyState v-if="!data.stages.length" :title="t('helpdesk.reports.empty')" />
              <ul v-else class="flex flex-col gap-2">
                <li v-for="stage in data.stages" :key="stage.name" class="flex items-center justify-between gap-3">
                  <span class="min-w-0 truncate text-sm text-highlighted">{{ stage.name }}</span>
                  <span class="shrink-0 text-sm text-muted"><bdi dir="ltr">{{ stage.count }}</bdi></span>
                </li>
              </ul>
            </SharedListCard>
          </div>
        </template>
      </SharedPageState>
    </template>
  </SharedPageContainer>
</template>
