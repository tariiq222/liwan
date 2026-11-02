<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectEvm } from '@/composables/useProjectEvm'
import { useProjectMissing } from '@/composables/useProjects'
import DashboardChart from '@/components/shared/data/DashboardChart.client.vue'
import { evmLineChart } from '@/components/pmo/projects/evm/evm'
import { formatMoney } from '@/utils/projectFinance'
import EvmIndices from '@/components/pmo/projects/evm/EvmIndices.vue'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'

// Earned value as of today against the latest baseline. Everything is computed on the server; this page only presents it.
const route = useRoute()
const { t } = useI18n()
const id = computed(() => Number(route.params.id))
const evm = useProjectEvm(id)
const notFound = useProjectMissing(id)
const noBaseline = computed(() => evm.error.value instanceof ApiError && evm.error.value.code === 'no_baseline')
const data = computed(() => evm.data.value)
const money = (value: number) => data.value?.currency ? formatMoney(value, data.value.currency) : String(value)
const chart = computed(() => data.value ? evmLineChart(data.value, { pv: t('projects.evm.series.pv'), ev: t('projects.evm.series.ev'), ac: t('projects.evm.series.ac') }, money) : null)
// The figure's accessible name carries what the plot shows: the day and the three values.
const chartLabel = computed(() => data.value && data.value.pv !== null && data.value.ev !== null
  ? t('projects.evm.curveLabel', { date: formatLiwanDate(data.value.as_of), pv: money(data.value.pv), ev: money(data.value.ev), ac: money(data.value.ac) })
  : t('projects.evm.noCurve'))
</script>

<template>
  <ProjectNotFoundState v-if="notFound" />
  <SharedListPage v-else hide-header :title="t('projects.evm.title')">
    <SharedEmptyState v-if="noBaseline" bordered :title="t('projects.evm.noBaseline')" :description="t('projects.evm.noBaselineHint')" data-testid="evm-no-baseline">
      <template #action><UButton color="neutral" variant="outline" :to="`/projects/${id}/baselines`" :label="t('nav.projectBaselines')" /></template>
    </SharedEmptyState>
    <SharedPageState v-else-if="evm.error.value" :error="evm.error.value" @retry="evm.refetch" />
    <template v-else-if="data">
      <div class="space-y-1 text-sm text-muted" data-testid="evm-method">
        <p>{{ t('projects.evm.asOf', { number: data.baseline_number, date: formatLiwanDate(data.as_of) }) }}</p>
        <p>{{ t(`projects.evm.method.${data.method}`) }}</p>
      </div>
      <UAlert v-if="data.hidden_count" color="warning" variant="subtle" data-testid="evm-hidden" :description="t('projects.evm.hidden', { count: data.hidden_count }, data.hidden_count)" />
      <UAlert v-if="data.undated_count" color="neutral" variant="subtle" data-testid="evm-undated" :description="t('projects.evm.undated', { count: data.undated_count }, data.undated_count)" />
      <UAlert v-if="data.bac === 0" color="neutral" variant="subtle" data-testid="evm-no-budget" :description="t('projects.evm.noBudget')" />
      <EvmIndices :evm="data" />
      <p class="text-xs text-muted" data-testid="evm-notes">{{ t('projects.evm.notes') }}</p>
      <SharedChartPanel :title="t('projects.evm.curveTitle')" :description="t('projects.evm.curveHint')" :empty="!chart" :empty-text="t('projects.evm.noCurve')" data-testid="evm-curve">
        <template #default="{ height }">
          <ClientOnly>
            <DashboardChart v-if="chart" :chart="chart" :accessible-label="chartLabel" :height="height" />
          </ClientOnly>
        </template>
      </SharedChartPanel>
    </template>
    <SharedPageState v-else :loading="evm.isLoading.value" />
  </SharedListPage>
</template>
