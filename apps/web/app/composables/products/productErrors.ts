import type { ProductManagedElsewhere } from './productManagement'

interface Refusal { status?: number; code?: string; field?: string; details?: unknown }

/** The fields of the product form a 422 can name. */
export type ProductFormField = 'name' | 'type' | 'list_price' | 'description' | 'image' | 'taxes'
const FORM_FIELDS: readonly string[] = ['name', 'type', 'list_price', 'description', 'image', 'taxes'] satisfies readonly ProductFormField[]

/** The form field a create or edit refusal belongs to; null for any other refusal. */
export function productFormField(error: unknown): ProductFormField | null {
  const failure = error as Refusal | null
  if (failure?.status !== 422 || !failure.field || !FORM_FIELDS.includes(failure.field)) return null
  return failure.field as ProductFormField
}

/**
 * Whether the form's top alert shows a refusal. A refusal that belongs to a field is shown at that field, but only when
 * the form renders that field; any other refusal stays at the top, so the user always sees it.
 */
export function productAlertVisible(error: unknown, rendered: ReadonlySet<ProductFormField>): boolean {
  if (!error) return false
  const field = productFormField(error)
  return field === null || !rendered.has(field)
}

/** The D23 reason a 403 carries (`managed_in_root_company` or `managed_in_branch`), or null for any other refusal. */
export function productManagedReason(error: unknown): ProductManagedElsewhere | null {
  const failure = error as Refusal | null
  if (failure?.status !== 403 || failure.code !== 'forbidden') return null
  const reason = (failure.details as { reason?: unknown } | undefined)?.reason
  return reason === 'managed_in_root_company' || reason === 'managed_in_branch' ? reason : null
}

/** Whether a settings write was refused because products already exist, so the sharing mode cannot change yet. */
export function isProductSharingTransferRequired(error: unknown): boolean {
  const failure = error as Refusal | null
  return failure?.status === 409 && failure.code === 'sharing_transfer_required'
}
