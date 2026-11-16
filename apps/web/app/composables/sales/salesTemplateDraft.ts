import type { SalesTemplate, SalesTemplateCreate, SalesTemplateLineInput } from '@liwan/contracts'
import { SALES_TEMPLATE_LIMITS } from '@liwan/contracts'
import { newSalesLine, salesLineProblems, type SalesLineDraft, type SalesLineProblem } from './salesOrderDraft'

/**
 * A quotation template as the form holds it. Its lines are the quotation editor's lines without a price: a product line
 * keeps a product and a quantity (the discount stays `0` and is never sent), a section or note line its text.
 */
export interface SalesTemplateDraft {
  name: string
  /** Null while the field is empty. 0 leaves the tenant's validity in force. */
  validityDays: number | null
  terms: string
  lines: SalesLineDraft[]
}

export interface SalesTemplateDraftErrors { name: boolean; validityDays: boolean; noLines: boolean; lines: Array<Partial<Record<SalesLineProblem, true>>> }

export function emptySalesTemplateDraft(): SalesTemplateDraft {
  return { name: '', validityDays: 0, terms: '', lines: [newSalesLine()] }
}

/** The editor state of a saved template. */
export function salesTemplateDraftFromTemplate(template: SalesTemplate): SalesTemplateDraft {
  return {
    name: template.name,
    validityDays: template.validity_days,
    terms: template.terms,
    lines: template.lines.map(line => ({
      ...newSalesLine(line.kind),
      productId: line.product?.id ?? null,
      productName: line.product?.name ?? '',
      name: line.name,
      quantity: String(line.quantity),
    })),
  }
}

const validDays = (days: number | null) => days !== null && Number.isInteger(days) && days >= 0 && days <= SALES_TEMPLATE_LIMITS.validityDays

/** What is wrong with the draft: an empty name, a validity out of range, no line at all, a line without its product, quantity or text. */
export function validateSalesTemplateDraft(draft: SalesTemplateDraft): SalesTemplateDraftErrors {
  return { name: !draft.name.trim(), validityDays: !validDays(draft.validityDays), noLines: !draft.lines.length, lines: draft.lines.map(salesLineProblems) }
}

export function hasSalesTemplateDraftErrors(errors: SalesTemplateDraftErrors): boolean {
  return errors.name || errors.validityDays || errors.noLines || errors.lines.some(line => Object.keys(line).length > 0)
}

/**
 * The body of one line: a product line sends its product and quantity, and the text staff wrote on it when it has one
 * (the server drops a text that is only the product's description); a section or note sends its text. No price, no discount.
 */
export function salesTemplateLinePayload(line: SalesLineDraft): SalesTemplateLineInput {
  if (line.kind !== 'product') return { kind: line.kind, name: line.name.trim() }
  const name = line.name.trim()
  return { kind: 'product', product_id: line.productId!, quantity: Number(line.quantity), ...(name ? { name } : {}) }
}

/** The create body, and the edit body: the whole template, whose lines replace the saved ones. */
export function salesTemplateBody(draft: SalesTemplateDraft): SalesTemplateCreate {
  return { name: draft.name.trim(), validity_days: draft.validityDays!, terms: draft.terms.trim(), lines: draft.lines.map(salesTemplateLinePayload) }
}

/** The draft without the editor's own keys, to tell an edit from the saved state. */
export function salesTemplateDraftSnapshot(draft: SalesTemplateDraft): string {
  return JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, ...line }) => line) })
}
