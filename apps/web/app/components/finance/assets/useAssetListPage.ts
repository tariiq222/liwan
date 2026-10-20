import { useFinanceAssetList } from '@/composables/finance/useFinanceAssets'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'
import { assetFiltersFromQuery, assetListParams } from './assetListParams'
import { ASSETS_PATH } from './assetPaths'

/**
 * The heading of the assets list page: title, the result count as a tag and the create link, which
 * carries the list's filters as its returnTo. The page owns the SharedListPage shell and AssetList draws the card in
 * it; `background` is the list behind the create panel, so its header is hidden. The result is reactive so `v-bind`
 * in the page template unwraps the computed values.
 */
export function useAssetListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const filterQuery = useListFilterQuery(ASSETS_PATH, background)
  const filters = computed(() => assetFiltersFromQuery(filterQuery.value))
  const query = useFinanceAssetList(() => assetListParams(filters.value), () => can('finance.assets.read'))
  const location = useListLocation(ASSETS_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeAssets.assets.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.assets.manage') ? { path: `${ASSETS_PATH}/new`, query: { returnTo: location.value } } : undefined)
  return reactive({
    title: t('financeAssets.assets.title'),
    tags,
    createTo,
    createLabel: t('financeAssets.assets.new'),
    createTestId: 'finance-asset-new',
    hideHeader: background,
    kpiToggle: true,
  })
}
