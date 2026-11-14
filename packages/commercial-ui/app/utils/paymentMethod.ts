// Display facts of a saved card, shared by the customer subscription page and the vendor console. The card is read only
// here: no token and no card id ever reach these helpers. Takes a structural shape so it imports no commercial contract (R5).
export type SavedCard = { brand: string; last_four: string; exp_month: number; exp_year: number; status: string }
export type SavedCardState = 'active' | 'inactive' | 'expired'

const RIYADH_OFFSET_MS = 3 * 3_600_000 // Riyadh is UTC+3 all year, with no daylight saving

/** A card is valid through the last day of its expiry month in Riyadh time: it expires at the first instant of the next month there. */
export function cardExpired(card: Pick<SavedCard, 'exp_month' | 'exp_year'>, now: Date): boolean {
  return now.getTime() >= Date.UTC(card.exp_year, card.exp_month, 1) - RIYADH_OFFSET_MS
}

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
