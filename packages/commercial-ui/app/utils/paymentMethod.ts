// Display facts of a saved card, shared by the customer subscription page and the vendor console. The card is read only
// here: no token and no card id ever reach these helpers. Expiry follows the contracts' one rule, the one the control plane charges by.
import { cardExpired } from '@liwan/commercial-contracts'

export type SavedCard = { brand: string; last_four: string; exp_month: number; exp_year: number; status: string }
export type SavedCardState = 'active' | 'inactive' | 'expired'

/** Expired wins over the stored status; a card the customer removed or the provider disabled reads as inactive. */
export function savedCardState(card: SavedCard, now: Date): SavedCardState {
  if (cardExpired(card, now)) return 'expired'
  return card.status === 'active' ? 'active' : 'inactive'
}

/** MM/YY, e.g. "03/28". */
export function cardExpiryLabel(card: Pick<SavedCard, 'exp_month' | 'exp_year'>): string {
  return `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year % 100).padStart(2, '0')}`
}

/** "•••• 1234": the only form of the number ever shown. */
export function maskedCardNumber(card: Pick<SavedCard, 'last_four'>): string {
  return `•••• ${card.last_four}`
}
