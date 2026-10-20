import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { statusTag, type PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import { useFinanceAsset, useValidateFinanceAsset } from '@/composables/finance/useFinanceAssets'
import { assetActions } from './assetActions'
import { financeErrorMessage } from '../financeErrors'
import { assetErrorKey } from './assetErrors'
import { ASSETS_PATH } from './assetPaths'
import { ASSET_STATE_TONE } from './assetTones'

/**
 * The state of one asset's record page: the loaded record, the heading props of SharedRecordPage (state and profile
 * tags, back link), the action its state and the caller's capabilities allow, and the confirmation of running it. The
 * page owns the SharedRecordPage shell; AssetRecordActions, AssetRecordBody and AssetRecordAside draw its slots from
 * this. The change waits for the server's answer; a refusal is shown inline in the caller's language.
 */
export function useAssetRecord() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const hydrated = useHydrated()

  const id = computed(() => Number(route.params.id))
  const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
  const query = useFinanceAsset(computed(() => validId.value ? id.value : null))
  const asset = computed(() => query.data.value)
  const backTo = computed(() => safeReturnTo(route.query.returnTo, ASSETS_PATH, [ASSETS_PATH]))
  const actions = computed(() => asset.value ? assetActions(asset.value, can) : null)
  const error = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))

  const tags = computed<PageHeaderTag[]>(() => {
    const record = asset.value
    if (!record) return []
    return [
      statusTag({ tone: ASSET_STATE_TONE[record.state], label: t(`financeAssets.states.${record.state}`) }, 'finance-asset-state'),
      { label: record.profile.name, kind: 'category', icon: 'i-lucide-layers', testId: 'finance-asset-profile' },
    ]
  })

  const confirming = ref(false)
  const actionError = ref('')
  const validation = useValidateFinanceAsset()
  const busy = computed(() => validation.isPending.value)

  async function applyValidation() {
    if (!hydrated.value || busy.value) return
    actionError.value = ''
    try {
      await validation.mutateAsync(id.value)
      confirming.value = false
    } catch (cause) {
      actionError.value = financeErrorMessage(cause, assetErrorKey, t)
    }
  }

  return reactive({
    // SharedRecordPage heading props: `v-bind="record.header"`.
    header: reactive({
      keepContent: computed(() => !!asset.value),
      title: computed(() => asset.value?.name ?? t('financeAssets.assets.record')),
      description: t('financeAssets.assets.record'),
      tags,
      backTo,
      loading: query.isLoading,
      error,
    }),
    retry: () => { void query.refetch() },
    asset,
    actions,
    busy,
    hydrated,
    confirming,
    actionError,
    applyValidation,
  })
}

export type AssetRecordState = ReturnType<typeof useAssetRecord>
