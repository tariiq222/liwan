import { useFinanceAssetList } from '@/composables/finance/useFinanceAssets'
import { useFinanceAssetSummary } from '@/composables/finance/useFinanceKpis'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'
import { assetFiltersFromQuery, assetKpiTiles, assetListParams, assetSummaryParams } from './assetListParams'
import { ASSETS_PATH } from './assetPaths'

/**
 * The assets list page: its heading (title, the result count as a tag and the create link, which carries the list's
 * filters as its returnTo) and the KPI strip of its `#kpis` slot, filled from one summary request asked only while the
 * strip is shown. The page owns the SharedListPage shell and AssetList draws the card in it; `background` is the list
 * behind the create panel, so its header is hidden. The result is reactive so the page template unwraps it.
 */
export function useAssetListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const { shown } = useKpiVisibility()
  const allowed = computed(() => can('finance.assets.read'))
  const filterQuery = useListFilterQuery(ASSETS_PATH, background)
  const filters = computed(() => assetFiltersFromQuery(filterQuery.value))
  const query = useFinanceAssetList(() => assetListParams(filters.value), allowed)
  const summary = useFinanceAssetSummary(() => assetSummaryParams(filters.value), () => shown.value && allowed.value)
  const location = useListLocation(ASSETS_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeAssets.assets.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.assets.manage') ? { path: `${ASSETS_PATH}/new`, query: { returnTo: location.value } } : undefined)
  const counts = computed(() => ({ total: summary.data.value?.total, draft: summary.data.value?.draft, open: summary.data.value?.open, close: summary.data.value?.close }))
  return reactive({
    header: {
      title: t('financeAssets.assets.title'),
      tags,
      createTo,
      createLabel: t('financeAssets.assets.new'),
      createTestId: 'finance-asset-new',
      hideHeader: background,
    },
    kpis: {
      shown,
      label: t('financeAssets.kpi.label'),
      tiles: computed(() => assetKpiTiles(filters.value, counts.value, t)),
      loading: computed(() => summary.isPending.value),
      error: computed(() => summary.isError.value),
    },
    allowed,
  })
}
