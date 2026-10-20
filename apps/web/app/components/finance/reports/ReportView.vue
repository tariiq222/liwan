<script setup lang="ts">
import { localIsoDay } from '@webvue/ui/app/utils/formatDate'
import { useFinanceReport } from '@/composables/finance/useFinanceReports'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import AgedBalanceTable from './AgedBalanceTable.vue'
import GeneralLedgerTable from './GeneralLedgerTable.vue'
import PartnerStatementTable from './PartnerStatementTable.vue'
import ReportFilters from './ReportFilters.vue'
import TrialBalanceTable from './TrialBalanceTable.vue'
import VatTable from './VatTable.vue'
import WithholdingTable from './WithholdingTable.vue'
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
const query = useFinanceReport(() => props.slug, () => reportParams(props.slug, filters.value), computed(() => allowed.value && ready.value))
const loaded = computed(() => query.data.value)
const loading = computed(() => ready.value && query.isPending.value)
const activeCount = computed(() => reportActiveFilterCount(props.slug, filters.value, today))
const tiles = computed(() => loaded.value ? reportKpiTiles(loaded.value, t, n) : [])
const tags = computed(() => reportHeaderTags(props.slug, filters.value, loaded.value, t))

const ledgerLines = computed(() => loaded.value?.slug === 'general-ledger' ? selectedLedgerLines(loaded.value.data, filters.value.accountId) : null)
const ledgerPages = computed(() => Math.max(1, Math.ceil((ledgerLines.value?.total ?? 0) / LEDGER_PAGE_SIZE)))

function clearFilters() {
  void update({ date_from: undefined, date_to: undefined, target_move: undefined, kind: undefined, type: undefined, partner_id: undefined, account_id: undefined, page: undefined })
}
</script>

<template>
  <SharedListPage :title="t(`financeReports.reports.${config.key}.title`)" :description="t(`financeReports.reports.${config.key}.description`)" :tags="tags" kpi-toggle>
    <SharedForbiddenState v-if="!allowed" :description="t('financeReports.forbidden')" />
    <div v-else class="webvue-page-stack">
      <SharedKpiStrip v-if="kpisShown && (loading || tiles.length)" :tiles="tiles" :loading="loading" :skeleton-count="3" :label="t('financeReports.kpi.label')" data-testid="finance-report-kpis" />
      <SharedListCard>
        <template #filters>
          <ReportFilters :slug="slug" :filters="filters" :active-count="activeCount" :disabled="!hydrated" @change="update" @clear="clearFilters" />
        </template>
        <SharedEmptyState v-if="!ready" class="m-(--webvue-card-pad-dense)" :title="t('financeReports.pickPartner.title')" :description="t('financeReports.pickPartner.description')" />
        <SharedPageState v-else :loading="loading" :error="query.error.value" :keep-content="!!loaded" @retry="query.refetch">
          <template v-if="loaded">
            <TrialBalanceTable v-if="loaded.slug === 'trial-balance'" :report="loaded.data" />
            <GeneralLedgerTable v-else-if="loaded.slug === 'general-ledger'" :report="loaded.data" :selected-id="filters.accountId" />
            <AgedBalanceTable v-else-if="loaded.slug === 'aged-partner-balance'" :report="loaded.data" />
            <PartnerStatementTable v-else-if="loaded.slug === 'partner-statement'" :report="loaded.data" />
            <VatTable v-else-if="loaded.slug === 'vat'" :report="loaded.data" />
            <WithholdingTable v-else :report="loaded.data" />
          </template>
        </SharedPageState>
        <template v-if="ledgerLines?.total" #footer>
          <SharedListFooter :count-label="t('financeReports.linesFooter', { shown: ledgerLines.items.length, total: ledgerLines.total }, ledgerLines.total)" :page="filters.page" :pages="ledgerPages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-ledger-line-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
        </template>
      </SharedListCard>
    </div>
  </SharedListPage>
</template>
