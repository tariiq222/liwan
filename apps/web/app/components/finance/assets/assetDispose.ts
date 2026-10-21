import type { FinanceAssetDispose } from '@webvue/contracts'

export interface AssetDisposeDraft {
  date: string | null
  saleValue: string
  saleAccountId: number | null
  plusAccountId: number | null
  minAccountId: number | null
  note: string
}

export const emptyDisposeDraft = (today: string): AssetDisposeDraft => ({ date: today, saleValue: '', saleAccountId: null, plusAccountId: null, minAccountId: null, note: '' })

const saleValueOf = (draft: AssetDisposeDraft) => draft.saleValue.trim() === '' ? 0 : Number(draft.saleValue)

/** A sale (proceeds above zero) says where the proceeds go; scrapping has no proceeds. */
export const isSale = (draft: AssetDisposeDraft) => saleValueOf(draft) > 0

export type DisposeErrors = Partial<Record<'date' | 'saleValue' | 'saleAccountId', 'required' | 'invalid'>>

export function validateDispose(draft: AssetDisposeDraft): DisposeErrors {
  const value = saleValueOf(draft)
  return {
    ...(draft.date ? {} : { date: 'required' as const }),
    ...(Number.isFinite(value) && value >= 0 ? {} : { saleValue: 'invalid' as const }),
    ...(isSale(draft) && draft.saleAccountId === null ? { saleAccountId: 'required' as const } : {}),
  }
}

export function buildDispose(draft: AssetDisposeDraft): FinanceAssetDispose {
  return {
    date_remove: draft.date!,
    ...(isSale(draft) ? { sale_value: saleValueOf(draft), sale_account_id: draft.saleAccountId! } : {}),
    ...(draft.plusAccountId !== null ? { plus_account_id: draft.plusAccountId } : {}),
    ...(draft.minAccountId !== null ? { min_account_id: draft.minAccountId } : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  }
}
