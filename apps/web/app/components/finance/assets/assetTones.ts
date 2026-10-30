import type { FinanceAsset, FinanceAssetDetail } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

export const ASSET_STATE_TONE: Record<FinanceAsset['state'], StatusTone> = {
  draft: 'neutral',
  open: 'success',
  close: 'info',
  removed: 'destructive',
}

export const LINE_TYPE_TONE: Record<FinanceAssetDetail['lines'][number]['type'], StatusTone> = {
  create: 'info',
  depreciate: 'neutral',
  remove: 'destructive',
}
