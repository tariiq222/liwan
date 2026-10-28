import type { FinanceAssetCreate, FinanceAssetDetail, FinanceAssetUpdate } from '@webvue/contracts'

const CODE_MAX = 32

/** The new-asset form as typed: amounts stay strings until they are validated. */
export interface AssetFormDraft {
  profileId: number | null
  name: string
  code: string
  purchaseValue: string
  salvageValue: string
  dateStart: string | null
  partnerId: number | null
  note: string
}

export type AssetFormField = 'profile' | 'name' | 'code' | 'purchaseValue' | 'salvageValue' | 'dateStart'
export type AssetFormErrors = Partial<Record<AssetFormField, true>>

export function emptyAssetDraft(today: string): AssetFormDraft {
  return { profileId: null, name: '', code: '', purchaseValue: '', salvageValue: '', dateStart: today, partnerId: null, note: '' }
}

/** A typed amount: a blank is zero only where `blankIsZero`, otherwise NaN, as is anything that is not a number. */
function amount(value: string, blankIsZero: boolean): number {
  if (value.trim() === '') return blankIsZero ? 0 : Number.NaN
  return Number(value)
}

export function validateAssetDraft(draft: AssetFormDraft): AssetFormErrors {
  const purchase = amount(draft.purchaseValue, false)
  const salvage = amount(draft.salvageValue, true)
  return {
    ...(draft.profileId ? {} : { profile: true as const }),
    ...(draft.name.trim() ? {} : { name: true as const }),
    ...(draft.code.trim().length <= CODE_MAX ? {} : { code: true as const }),
    ...(purchase > 0 && Number.isFinite(purchase) ? {} : { purchaseValue: true as const }),
    ...(salvage >= 0 && Number.isFinite(salvage) ? {} : { salvageValue: true as const }),
    ...(draft.dateStart ? {} : { dateStart: true as const }),
  }
}

export const hasAssetErrors = (errors: AssetFormErrors) => Object.keys(errors).length > 0

export function buildAssetCreate(draft: AssetFormDraft): FinanceAssetCreate {
  const code = draft.code.trim()
  const note = draft.note.trim()
  return {
    profile_id: draft.profileId!,
    name: draft.name.trim(),
    ...(code ? { code } : {}),
    purchase_value: Number(draft.purchaseValue),
    ...(draft.salvageValue.trim() ? { salvage_value: Number(draft.salvageValue) } : {}),
    date_start: draft.dateStart!,
    ...(draft.partnerId ? { partner_id: draft.partnerId } : {}),
    ...(note ? { note } : {}),
  }
}

/** The edit form of a draft asset, filled with what it holds now; a salvage value of zero shows blank, like a new one. */
export function assetDraftFromRecord(asset: FinanceAssetDetail): AssetFormDraft {
  return {
    profileId: asset.profile.id,
    name: asset.name,
    code: asset.code,
    purchaseValue: String(asset.purchase_value),
    salvageValue: asset.salvage_value ? String(asset.salvage_value) : '',
    dateStart: asset.date_start,
    partnerId: asset.partner?.id ?? null,
    note: asset.note,
  }
}

/** The edit body: only what differs from the asset as loaded, so an untouched field (and the method) stays as it is. An emptied code, note or partner clears it. */
export function buildAssetUpdate(draft: AssetFormDraft, initial: AssetFormDraft): FinanceAssetUpdate {
  const salvage = (value: string) => value.trim() === '' ? 0 : Number(value)
  return {
    ...(draft.profileId !== initial.profileId ? { profile_id: draft.profileId! } : {}),
    ...(draft.name.trim() !== initial.name.trim() ? { name: draft.name.trim() } : {}),
    ...(draft.code.trim() !== initial.code.trim() ? { code: draft.code.trim() } : {}),
    ...(Number(draft.purchaseValue) !== Number(initial.purchaseValue) ? { purchase_value: Number(draft.purchaseValue) } : {}),
    ...(salvage(draft.salvageValue) !== salvage(initial.salvageValue) ? { salvage_value: salvage(draft.salvageValue) } : {}),
    ...(draft.dateStart !== initial.dateStart ? { date_start: draft.dateStart! } : {}),
    ...(draft.partnerId !== initial.partnerId ? { partner_id: draft.partnerId } : {}),
    ...(draft.note.trim() !== initial.note.trim() ? { note: draft.note.trim() } : {}),
  }
}

export const assetDraftDirty = (draft: AssetFormDraft, initial: AssetFormDraft) => JSON.stringify(draft) !== JSON.stringify(initial)
