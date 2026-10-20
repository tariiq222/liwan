import type { FinanceAsset } from '@webvue/contracts'

type Can = (capability: string) => boolean

export interface AssetActionSet {
  validate: boolean
}

/** What the record page offers: only a draft can be run, and only by whoever manages assets. */
export function assetActions(asset: Pick<FinanceAsset, 'state'>, can: Can): AssetActionSet {
  return { validate: asset.state === 'draft' && can('finance.assets.manage') }
}
