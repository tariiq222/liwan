import type { FinanceAssetProfile } from '@liwan/contracts'

type Translate = (key: string, params?: Record<string, unknown>, count?: number) => string
export type AssetMethodSource = Pick<FinanceAssetProfile, 'method' | 'method_time' | 'method_number' | 'method_period'>

/** How long the asset depreciates: a number of years, or a number of depreciation periods. */
export const assetDuration = (source: AssetMethodSource, t: Translate) =>
  t(`financeAssets.duration.${source.method_time}`, { count: source.method_number }, source.method_number)

/** One line saying how an asset depreciates: the method, the duration and the period length. */
export const assetMethodSummary = (source: AssetMethodSource, t: Translate) =>
  [t(`financeAssets.methods.${source.method}`), assetDuration(source, t), t(`financeAssets.periods.${source.method_period}`)].join(' · ')
