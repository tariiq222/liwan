import type { Customer, CustomerCreate, CustomerPatch, CustomFieldValues } from '@liwan/contracts'

/** What the customer form holds: the typed identity and the custom field values it changed. */
export interface CustomerDraft {
  name: string
  phone: string
  email: string
  isCompany: boolean
  /** Whether the person/company choice is on the form; without it the party kind is never part of an edit. */
  canChoosePartyKind: boolean
  /** The company the customer belongs to, or null for none. */
  parentId: number | null
  changedFields: CustomFieldValues
}

const trimmed = (value: string) => value.trim() || null

/** The create body: an empty phone or email is left out, and `create_new` only after the user chose to. */
export function customerCreateBody(draft: CustomerDraft, createNew: boolean): CustomerCreate {
  const phone = trimmed(draft.phone)
  const email = trimmed(draft.email)
  return {
    name: draft.name.trim(),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    is_company: draft.isCompany,
    ...(draft.parentId !== null ? { parent_id: draft.parentId } : {}),
    ...(Object.keys(draft.changedFields).length ? { properties: draft.changedFields } : {}),
    ...(createNew ? { create_new: true as const } : {}),
  }
}

/** The edit body: only what differs from the saved customer; an emptied phone or email is sent as null. */
export function customerPatchBody(customer: Customer, draft: CustomerDraft): CustomerPatch {
  const patch: CustomerPatch = {}
  if (draft.name.trim() !== customer.name) patch.name = draft.name.trim()
  if (trimmed(draft.phone) !== customer.phone) patch.phone = trimmed(draft.phone)
  if (trimmed(draft.email) !== customer.email) patch.email = trimmed(draft.email)
  if (draft.canChoosePartyKind && draft.isCompany !== customer.is_company) patch.is_company = draft.isCompany
  if (draft.parentId !== (customer.parent?.id ?? null)) patch.parent_id = draft.parentId
  if (Object.keys(draft.changedFields).length) patch.properties = draft.changedFields
  return patch
}
