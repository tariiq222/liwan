import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { statusTag, type PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import { useDeleteFinanceAsset, useFinanceAsset, useValidateFinanceAsset } from '@/composables/finance/useFinanceAssets'
import { financeErrorMessage } from '../financeErrors'
import { offeredMenuItems, readFinanceActions } from '../financeActions'
import { assetErrorKey } from './assetErrors'
import { ASSETS_PATH } from './assetPaths'
import { ASSET_STATE_TONE } from './assetTones'

/**
 * The state of one asset's record page: the loaded record, the heading props of SharedRecordPage (state and profile
 * tags, back link), the actions the server allows, the edit mode and the one confirmation open at a time. The page owns
 * the SharedRecordPage shell; AssetRecordActions, AssetRecordBody and AssetRecordAside draw its slots from this. Every
 * change waits for the server's answer; a refusal is shown inline in the caller's language.
 */
export type AssetConfirmation = 'validate' | 'delete'

export function useAssetRecord() {
  const route = useRoute()
  const { t } = useI18n()
  const hydrated = useHydrated()

  const id = computed(() => Number(route.params.id))
  const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
  const query = useFinanceAsset(computed(() => validId.value ? id.value : null))
  const asset = computed(() => query.data.value)
  const backTo = computed(() => safeReturnTo(route.query.returnTo, ASSETS_PATH, [ASSETS_PATH]))
  const actions = computed(() => asset.value ? readFinanceActions(asset.value) : null)
  const error = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))

  const tags = computed<PageHeaderTag[]>(() => {
    const record = asset.value
    if (!record) return []
    return [
      statusTag({ tone: ASSET_STATE_TONE[record.state], label: t(`financeAssets.states.${record.state}`) }, 'finance-asset-state'),
      { label: record.profile.name, kind: 'category', icon: 'i-lucide-layers', testId: 'finance-asset-profile' },
    ]
  })

  const confirming = ref<AssetConfirmation | null>(null)
  const disposing = ref(false)
  const editing = ref(false)
  // A draft run elsewhere while it is open here leaves edit mode, so the running asset's actions come back.
  watch(() => actions.value?.can('edit'), canEdit => { if (!canEdit) editing.value = false })
  const actionError = ref('')
  const validation = useValidateFinanceAsset()
  const removal = useDeleteFinanceAsset()
  const busy = computed(() => validation.isPending.value || removal.isPending.value)

  async function attempt(work: () => Promise<unknown>) {
    if (!hydrated.value || busy.value) return false
    actionError.value = ''
    try {
      await work()
      confirming.value = null
      return true
    } catch (cause) {
      actionError.value = financeErrorMessage(cause, assetErrorKey, t)
      return false
    }
  }
  const applyValidation = () => attempt(() => validation.mutateAsync(id.value))
  async function applyDelete() {
    if (await attempt(() => removal.mutateAsync(id.value))) await navigateTo(backTo.value, { replace: true })
  }

  function edit() {
    confirming.value = null
    actionError.value = ''
    editing.value = true
  }
  const menu = computed(() => {
    const set = actions.value
    if (!set) return []
    return offeredMenuItems(set, [
      ['delete', { label: t('financeAssets.actions.delete'), icon: 'i-lucide-trash-2', destructive: true, onSelect: () => { confirming.value = 'delete' } }],
    ])
  })

  return reactive({
    // SharedRecordPage heading props: `v-bind="record.header"`.
    header: reactive({
      keepContent: computed(() => !!asset.value),
      title: computed(() => asset.value?.name ?? t('financeAssets.assets.record')),
      tags,
      backTo,
      loading: query.isLoading,
      error,
    }),
    retry: () => { void query.refetch() },
    asset,
    actions,
    menu,
    busy,
    hydrated,
    backTo,
    confirming,
    disposing,
    editing,
    edit,
    actionError,
    applyValidation,
    applyDelete,
  })
}

export type AssetRecordState = ReturnType<typeof useAssetRecord>
