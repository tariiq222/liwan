import type { CompanyTax, CompanyTaxPatch } from '@liwan/contracts'

/** The three answers of the one establishment-wide tax choice; `none` folds "not registered" over the price mode. */
export type CompanyTaxChoice = CompanyTax['choice']
/** The two price modes the stock setting stores; the one an unregistered establishment keeps for a later registration. */
export type CompanyTaxPriceMode = CompanyTax['price_mode']

/** What the tax card edits: whether the establishment is registered, and what a price typed on a product means. */
export interface CompanyTaxDraft {
  registered: boolean
  priceMode: CompanyTaxPriceMode
}

export function taxDraft(tax: CompanyTax): CompanyTaxDraft {
  return { registered: tax.registered, priceMode: tax.price_mode }
}

/** The option the three-way choice shows as selected. */
export function chosenOption(draft: CompanyTaxDraft): CompanyTaxChoice {
  return draft.registered ? draft.priceMode : 'none'
}

/** Picking an option: "no tax" keeps the price mode the establishment will register under later. */
export function chooseOption(draft: CompanyTaxDraft, choice: CompanyTaxChoice): CompanyTaxDraft {
  return choice === 'none' ? { ...draft, registered: false } : { registered: true, priceMode: choice }
}

/**
 * Whether picking `choice` would change the price mode the establishment is locked to. Before the first accounting
 * entry nothing is locked; after it only "no tax" and the stored price mode stay open, so registration can still be
 * switched on and off.
 */
export function optionLocked(tax: CompanyTax, choice: CompanyTaxChoice): boolean {
  return tax.locked && choice !== 'none' && choice !== tax.price_mode
}

/** The PATCH body: only the fields that changed, null when the draft holds the saved answer. */
export function taxUpdate(saved: CompanyTax, draft: CompanyTaxDraft): CompanyTaxPatch | null {
  const patch: CompanyTaxPatch = {}
  if (draft.registered !== saved.registered) patch.registered = draft.registered
  if (draft.priceMode !== saved.price_mode) patch.price_mode = draft.priceMode
  return Object.keys(patch).length ? patch : null
}

/**
 * The owning locale message of a refusal the tax route can answer; null for anything else, so the shared `useApi`
 * message (the plan limit, a read-only seat, a read-only branch) reaches the reader unchanged. A missing VAT number is
 * the card's own client guard; the server's `invalid_vat` is a number the country's check refused.
 */
export function taxErrorKey(error: unknown): string | null {
  const status = (error as { status?: unknown } | null)?.status
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'tax_mode_locked') return 'settings.company.tax.errors.locked'
  if (code === 'forbidden') return 'settings.company.tax.errors.forbidden'
  if (code === 'invalid_vat') return 'settings.company.tax.errors.invalidVat'
  if (code === 'vat_check_unavailable') return 'settings.company.tax.errors.vatUnchecked'
  if (status === 422) return 'settings.company.tax.errors.invalid'
  return null
}
