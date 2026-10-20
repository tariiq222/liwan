import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { ASSETS_PATH, assetRecordPath } from './assetPaths'
import { useAssetListPage } from './useAssetListPage'

/**
 * What the asset create page needs: the list that stays behind the panel (its header hidden), the panel title and its
 * way back, and where a saved asset goes: its record page, carrying the same list origin.
 */
export function useAssetCreatePage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const backTo = computed(() => safeReturnTo(route.query.returnTo, ASSETS_PATH, [ASSETS_PATH]))
  function saved(id: number) {
    void navigateTo({ path: assetRecordPath(id), query: { returnTo: backTo.value } }, { replace: true })
  }
  return reactive({
    list: useAssetListPage(true),
    title: t('financeAssets.assets.new'),
    backTo,
    allowed: computed(() => can('finance.assets.manage')),
    saved,
  })
}
