import type { FinanceAsset } from '@webvue/contracts'

type Can = (capability: string) => boolean

export interface AssetActionSet {
  validate: boolean
  dispose: boolean
}

/** What the record page offers to whoever manages assets: a draft can be run; a running or fully depreciated asset can be sold or scrapped. */
export function assetActions(asset: Pick<FinanceAsset, 'state'>, can: Can): AssetActionSet {
  const manage = can('finance.assets.manage')
  return { validate: manage && asset.state === 'draft', dispose: manage && (asset.state === 'open' || asset.state === 'close') }
}
