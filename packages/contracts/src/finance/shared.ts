import { z } from 'zod'

export const id = z.number().int().positive()
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const currency = z.string().min(1)

export const FinanceRefSchema = z.object({ id, name: z.string() }).strict()

export const list = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() }).strict()

// Request bodies: money is a plain JSON number, never a string.
const MAX_TEXT = 255
// Odoo money columns overflow beyond this; the server answers 422 for a larger number.
export const MAX_NUMBER = 1e12
export const money = z.number().gt(-MAX_NUMBER).lt(MAX_NUMBER)
export const text = z.string().max(MAX_TEXT)
export const requirePatchField = (value: object) => Object.keys(value).length > 0
export const PATCH_MESSAGE = { message: 'At least one field is required' }

/**
 * Why an action a record's state and the caller's role offer is refused right now. Each is the `code` of the refusal the
 * action's route answers with, so the explanation next to a disabled button and the error after a forced call agree.
 */
export const FinanceActionBlockReasonSchema = z.enum([
  'tenant_read_only', 'tenant_suspended', 'feature_not_included', 'period_locked',
  'has_payments', 'has_reconciliations', 'zatca_not_onboarded', 'zatca_mode_not_allowed',
])

/**
 * What a finance record offers the caller, decided by the server from its state, the caller's capability, the tenant's
 * write entitlement and the facts that refuse it: `allowed_actions` can be run now, `blocked_actions` are offered but
 * refused for `reason` (show the button disabled with the explanation). An action in neither is not offered.
 */
export const financeActions = <T extends z.ZodType>(action: T) => ({
  allowed_actions: z.array(action),
  blocked_actions: z.array(z.object({ action, reason: FinanceActionBlockReasonSchema }).strict()),
})
