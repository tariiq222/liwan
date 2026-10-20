<script setup lang="ts">
import { localIsoDay } from '@webvue/ui/app/utils/formatDate'
import { analyticLineParams, ANALYTIC_LINE_PAGE_SIZE } from '../analytic/analyticParams'
import { useFinanceAnalyticLines } from '@/composables/finance/useFinanceAnalytic'
import { useFinanceReport } from '@/composables/finance/useFinanceReports'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import BudgetVarianceTable from '../budgets/BudgetVarianceTable.vue'
import AgedBalanceTable from './AgedBalanceTable.vue'
import AnalyticTable from './AnalyticTable.vue'
import GeneralLedgerTable from './GeneralLedgerTable.vue'
import MisLinesTable from './MisLinesTable.vue'
import PartnerStatementTable from './PartnerStatementTable.vue'
import ReportFilters from './ReportFilters.vue'
import TrialBalanceTable from './TrialBalanceTable.vue'
import VatTable from './VatTable.vue'
import WithholdingTable from './WithholdingTable.vue'
import ZakatBaseTable from './ZakatBaseTable.vue'
import { REPORTS, type ReportSlug } from './reportConfig'
import { LEDGER_PAGE_SIZE, reportActiveFilterCount, reportFiltersFromQuery, reportParams, reportReady } from './reportParams'
import { reportKpiTiles } from './reportKpis'
import { selectedLedgerLines } from './reportRows'
import { reportHeaderTags } from './reportTags'

// One finance report: heading, the report's own server totals as tiles, and one card with its filters and table.
// Every filter lives in the URL; the period defaults to this month and is written only once the user changes it.
const props = defineProps<{ slug: ReportSlug }>()
const { t, n } = useI18n()
const { can } = useAccess()
const { shown: kpisShown } = useKpiVisibility()
const today = localIsoDay()
const config = computed(() => REPORTS[props.slug])
const allowed = computed(() => can(config.value.capability))
const { hydrated, filterQuery, update } = useRouteListFilters({
  fallbackPath: () => `/finance/reports/${props.slug}`,
  safeReturnTo: (_value, fallback) => fallback,
})
const filters = computed(() => reportFiltersFromQuery(filterQuery.value, today))
const ready = computed(() => reportReady(props.slug, filters.value))
// What a report that needs a partner or a budget asks for until one is chosen.
const pickPrompt = computed(() => config.value.filters.budget
  ? { title: t('financeReports.pickBudget.title'), description: t('financeReports.pickBudget.description') }
  : { title: t('financeReports.pickPartner.title'), description: t('financeReports.pickPartner.description') })
const query = useFinanceReport(() => props.slug, () => reportParams(props.slug, filters.value), computed(() => allowed.value && ready.value))
const loaded = computed(() => query.data.value)
const loading = computed(() => ready.value && query.isPending.value)
const activeCount = computed(() => reportActiveFilterCount(props.slug, filters.value, today))
const tiles = computed(() => loaded.value ? reportKpiTiles(loaded.value, t, n) : [])
const tags = computed(() => reportHeaderTags(props.slug, filters.value, loaded.value, t))

const ledgerLines = computed(() => loaded.value?.slug === 'general-ledger' ? selectedLedgerLines(loaded.value.data, filters.value.accountId) : null)
// The cost center report names its items in a second request; the selected cost center and its page come from the URL.
const analyticLines = useFinanceAnalyticLines(
  () => analyticLineParams(filters.value.accountId ?? 0, filters.value, filters.value.page),
  computed(() => allowed.value && props.slug === 'analytic' && filters.value.accountId !== null),
)
const analyticItems = computed(() => analyticLines.data.value?.items ?? [])
// The open account's lines, whichever report they come from: shown count, total and the page size that pages them.
const lineFooter = computed(() => {
  if (ledgerLines.value) return { shown: ledgerLines.value.items.length, total: ledgerLines.value.total, size: LEDGER_PAGE_SIZE, fetching: query.isFetching.value }
  const lines = analyticLines.data.value
  return props.slug === 'analytic' && filters.value.accountId !== null && lines ? { shown: lines.items.length, total: lines.total, size: ANALYTIC_LINE_PAGE_SIZE, fetching: query.isFetching.value || analyticLines.isFetching.value } : null
})

function clearFilters() {
  void update({ date_from: undefined, date_to: undefined, target_move: undefined, kind: undefined, type: undefined, partner_id: undefined, account_id: undefined, plan_id: undefined, budget_id: undefined, page: undefined })
}
</script>

<template>
  <SharedListPage :title="t(`financeReports.reports.${config.key}.title`)" :tags="tags" kpi-toggle>
    <SharedForbiddenState v-if="!allowed" :description="t('financeReports.forbidden')" />
    <div v-else class="webvue-page-stack">
      <SharedKpiStrip v-if="kpisShown && (loading || tiles.length)" :tiles="tiles" :loading="loading" :skeleton-count="3" :label="t('financeReports.kpi.label')" data-testid="finance-report-kpis" />
      <SharedListCard>
        <template #filters>
          <ReportFilters :slug="slug" :filters="filters" :active-count="activeCount" :disabled="!hydrated" @change="update" @clear="clearFilters" />
        </template>
        <SharedEmptyState v-if="!ready" class="m-(--webvue-card-pad-dense)" :title="pickPrompt.title" :description="pickPrompt.description" />
        <SharedPageState v-else :loading="loading" :error="query.error.value" :keep-content="!!loaded" @retry="query.refetch">
          <template v-if="loaded">
            <TrialBalanceTable v-if="loaded.slug === 'trial-balance'" :report="loaded.data" />
            <GeneralLedgerTable v-else-if="loaded.slug === 'general-ledger'" :report="loaded.data" :selected-id="filters.accountId" />
            <AgedBalanceTable v-else-if="loaded.slug === 'aged-partner-balance'" :report="loaded.data" />
            <PartnerStatementTable v-else-if="loaded.slug === 'partner-statement'" :report="loaded.data" />
            <VatTable v-else-if="loaded.slug === 'vat'" :report="loaded.data" />
            <AnalyticTable v-else-if="loaded.slug === 'analytic'" :report="loaded.data" :selected-id="filters.accountId" :lines="analyticItems" :lines-failed="!!analyticLines.error.value" />
            <MisLinesTable v-else-if="loaded.slug === 'profit-loss'" kind="profitLoss" :lines="loaded.data.lines" :currency="loaded.data.currency" :caption="t('financeReports.reports.profitLoss.title')" />
            <MisLinesTable v-else-if="loaded.slug === 'balance-sheet'" kind="balanceSheet" :lines="loaded.data.lines" :currency="loaded.data.currency" :caption="t('financeReports.reports.balanceSheet.title')" />
            <ZakatBaseTable v-else-if="loaded.slug === 'zakat-base'" :report="loaded.data" />
            <BudgetVarianceTable v-else-if="loaded.slug === 'budget-vs-actual'" :lines="loaded.data.lines" :caption="t('financeReports.reports.budgetVsActual.title')" />
            <WithholdingTable v-else :report="loaded.data" />
          </template>
        </SharedPageState>
        <template v-if="lineFooter?.total" #footer>
          <SharedListFooter :count-label="t('financeReports.linesFooter', { shown: lineFooter.shown, total: lineFooter.total }, lineFooter.total)" :page="filters.page" :pages="Math.max(1, Math.ceil(lineFooter.total / lineFooter.size))" :disabled="!hydrated || lineFooter.fetching" count-test-id="finance-ledger-line-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
        </template>
      </SharedListCard>
    </div>
  </SharedListPage>
</template>
