<script setup lang="ts">
import SalesReportBreakdown from '@/components/sales/SalesReportBreakdown.vue'
import SalesReportFilters from '@/components/sales/SalesReportFilters.vue'
import { parseSalesReportQuery, SALES_REPORT_KEYS, SALES_REPORT_PAGE_SIZE, SALES_REPORTS_PATH } from '@/composables/sales/salesReportParams'
import { useSalesReportBreakdown, useSalesReportExport, useSalesReportSummary } from '@/composables/sales/useSalesReports'
import { listPageNumber, safeListReturnTo, useLastPageClamp, useRouteListFilters } from '@/composables/useRouteListFilters'
import { exportTooLargeMessage } from '@/utils/exportErrors'
import { salesReportTiles } from '@/utils/salesReports'

// Orders and amounts of the sales documents the caller reads, by period, salesperson, customer or product, with a CSV of
// the rows behind the filters. The whole state (range, stage, source, dimension, page) is the address, so a direct link, a
// refresh and Back keep it (each change is a history entry, so Back steps through the filters). The server counts only what the caller's visibility setting lets them read.
const { t, n, locale } = useI18n()
const toast = useToast()
const { can } = useAccess()
const { hydrated, filterQuery, update } = useRouteListFilters({ fallbackPath: () => SALES_REPORTS_PATH, safeReturnTo: value => safeListReturnTo(SALES_REPORTS_PATH, value), history: 'push' })

const allowed = computed(() => can('sales.reports.read') && can('sales.read'))
const state = computed(() => parseSalesReportQuery(filterQuery.value))
const summary = useSalesReportSummary(state, allowed)
const breakdown = useSalesReportBreakdown(state, allowed)
const tiles = computed(() => (summary.data.value ? salesReportTiles(summary.data.value, t, locale.value) : []))
useLastPageClamp({ page: () => listPageNumber(state.value.page), total: () => breakdown.data.value?.total, pageSize: SALES_REPORT_PAGE_SIZE })

const exportCsv = useSalesReportExport()
function downloadCsv() {
  exportCsv.mutate(state.value, { onError: error => toast.add({ title: exportTooLargeMessage(error, t, n) ?? t('sales.reports.exportFailed'), color: 'error' }) })
}
const clearAll = () => update(Object.fromEntries(SALES_REPORT_KEYS.filter(key => !['by', 'period'].includes(key)).map(key => [key, undefined])))
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('sales.reports.title')" :description="t('sales.reports.description')" kpi-toggle>
      <template v-if="allowed" #actions>
        <UButton
          variant="outline"
          icon="i-lucide-download"
          :loading="exportCsv.isPending.value"
          :disabled="!hydrated || exportCsv.isPending.value"
          data-testid="sales-report-export"
          @click="downloadCsv"
        >{{ t(exportCsv.isPending.value ? 'sales.reports.exporting' : 'sales.reports.export') }}</UButton>
      </template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!allowed" />
    <template v-else>
      <SharedPageState v-if="summary.error.value && !summary.data.value" :error="summary.error.value" @retry="summary.refetch()" />
      <SharedKpiStrip v-else :tiles="tiles" :loading="summary.isPending.value" :label="t('sales.reports.title')" data-testid="sales-report-tiles" />
      <SalesReportBreakdown :state="state" :report="breakdown.data.value" :loading="breakdown.isPending.value" :error="breakdown.error.value" :disabled="!hydrated" @update:query="update" @retry="breakdown.refetch()">
        <template #filters>
          <SalesReportFilters :state="state" :disabled="!hydrated" @update:query="update" @clear="clearAll" />
        </template>
      </SalesReportBreakdown>
    </template>
  </SharedPageContainer>
</template>
