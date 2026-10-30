import {
  INBOX_COMMERCE_LIMITS, InboxCommerceContentSchema,
  type InboxCatalogItemReview, type InboxCatalogItemSyncState, type InboxCatalogState, type InboxCommerceContent, type InboxMessageCommerce, type InboxOrder, type InboxOrderPaymentStatus, type InboxOrderState,
} from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

// Pure helpers of the WhatsApp commerce screens: the product message an agent, a rule or an automatic message sends from
// the channel's catalog (a draft, Meta's limits, the wire content), the totals and money of a cart, and the tone and
// label key of every status. The contract schemas decide what may be sent; the limits here are the contract's.

export const COMMERCE_LIMITS = INBOX_COMMERCE_LIMITS

// ---------------------------------------------------------------- the commerce message draft

export type CommerceType = InboxCommerceContent['type']
export const COMMERCE_TYPES: readonly CommerceType[] = ['product', 'product_list', 'catalog_message']

export interface CommerceSectionDraft { title: string; ids: string[] }
export interface CommerceDraft {
  type: CommerceType
  header: string
  body: string
  footer: string
  /** The one product of a single-product message. */
  productId: string | null
  /** The product whose image heads a catalog message; null lets WhatsApp use the first catalog item. */
  thumbnailId: string | null
  sections: CommerceSectionDraft[]
}

export const emptyCommerceDraft = (sectionTitle = ''): CommerceDraft => ({
  type: 'product_list', header: '', body: '', footer: '', productId: null, thumbnailId: null, sections: [{ title: sectionTitle, ids: [] }],
})

const orNull = (value: string) => value.trim() || null

export const commerceProductIds = (draft: CommerceDraft): string[] => draft.sections.flatMap(section => section.ids)

/** How many products the message names, whatever its type. */
export function commerceProductCount(draft: CommerceDraft): number {
  if (draft.type === 'product') return draft.productId ? 1 : 0
  return draft.type === 'product_list' ? commerceProductIds(draft).length : 0
}

/** The wire content, or null while the draft is empty or breaks a limit. */
export function buildCommerceContent(draft: CommerceDraft): InboxCommerceContent | null {
  let candidate: unknown
  if (draft.type === 'product') {
    candidate = { type: 'product', body: orNull(draft.body), footer: orNull(draft.footer), product_retailer_id: draft.productId }
  } else if (draft.type === 'product_list') {
    candidate = {
      type: 'product_list', header: draft.header.trim(), body: draft.body.trim(), footer: orNull(draft.footer),
      sections: draft.sections.filter(section => section.ids.length).map(section => ({ title: section.title.trim(), product_retailer_ids: section.ids })),
    }
  } else {
    candidate = { type: 'catalog_message', body: draft.body.trim(), footer: orNull(draft.footer), thumbnail_product_retailer_id: draft.thumbnailId }
  }
  const parsed = InboxCommerceContentSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/** The editable draft of a stored commerce content (a rule reply or an automatic message being edited). */
export function commerceToDraft(content: InboxCommerceContent): CommerceDraft {
  const draft = emptyCommerceDraft()
  draft.type = content.type
  draft.footer = content.footer ?? ''
  if (content.type === 'product') {
    draft.body = content.body ?? ''
    draft.productId = content.product_retailer_id
  } else if (content.type === 'product_list') {
    draft.header = content.header
    draft.body = content.body
    draft.sections = content.sections.map(section => ({ title: section.title, ids: [...section.product_retailer_ids] }))
  } else {
    draft.body = content.body
    draft.thumbnailId = content.thumbnail_product_retailer_id
  }
  return draft
}

/** The first reason a draft cannot be sent yet, as a locale key under `inbox.catalog.picker.problems`; null when it can. */
export function commerceProblem(draft: CommerceDraft): string | null {
  if (draft.type === 'product') return draft.productId ? null : 'productRequired'
  if (draft.type === 'catalog_message') return draft.body.trim() ? null : 'bodyRequired'
  const used = draft.sections.filter(section => section.ids.length)
  if (!used.length) return 'productsRequired'
  if (commerceProductIds(draft).length > COMMERCE_LIMITS.products) return 'tooManyProducts'
  if (!draft.header.trim()) return 'headerRequired'
  if (!draft.body.trim()) return 'bodyRequired'
  if (used.some(section => !section.title.trim())) return 'sectionTitleRequired'
  return null
}

/** The draft with a product added to, or taken out of, the section being filled; a product appears once in a list. */
export function toggleDraftProduct(draft: CommerceDraft, id: string, sectionIndex: number): void {
  if (draft.type === 'product') {
    draft.productId = draft.productId === id ? null : id
    return
  }
  if (draft.type === 'catalog_message') {
    draft.thumbnailId = draft.thumbnailId === id ? null : id
    return
  }
  const holder = draft.sections.find(section => section.ids.includes(id))
  if (holder) {
    holder.ids = holder.ids.filter(item => item !== id)
    return
  }
  if (commerceProductIds(draft).length >= COMMERCE_LIMITS.products) return
  draft.sections[Math.min(sectionIndex, draft.sections.length - 1)]?.ids.push(id)
}

/** The ids the picker shows as chosen for the draft's type. */
export function pickedIds(draft: CommerceDraft): string[] {
  if (draft.type === 'product') return draft.productId ? [draft.productId] : []
  if (draft.type === 'catalog_message') return draft.thumbnailId ? [draft.thumbnailId] : []
  return commerceProductIds(draft)
}

export function addDraftSection(draft: CommerceDraft): boolean {
  if (draft.sections.length >= COMMERCE_LIMITS.sections) return false
  draft.sections.push({ title: '', ids: [] })
  return true
}

/** Removing a section drops its products; the last section stays (empty) so the draft always has one to fill. */
export function removeDraftSection(draft: CommerceDraft, index: number): void {
  if (draft.sections.length === 1) draft.sections[0] = { title: draft.sections[0]!.title, ids: [] }
  else draft.sections.splice(index, 1)
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** A stored draft, defensively read back (storage is untrusted); null when it is not a commerce draft. */
export function normalizeCommerceDraft(value: unknown): CommerceDraft | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!COMMERCE_TYPES.includes(source.type as CommerceType)) return null
  const sections = Array.isArray(source.sections)
    ? source.sections.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map(section => ({ title: text(section.title), ids: strings(section.ids) }))
    : []
  return {
    type: source.type as CommerceType, header: text(source.header), body: text(source.body), footer: text(source.footer),
    productId: typeof source.productId === 'string' ? source.productId : null, thumbnailId: typeof source.thumbnailId === 'string' ? source.thumbnailId : null,
    sections: sections.length ? sections : emptyCommerceDraft().sections,
  }
}

// ---------------------------------------------------------------- money, carts and orders

/** An amount in its currency, in the page locale; a bare number when the currency code is not one the browser knows. */
export function formatInboxMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

/** The sum of quantity times price over the lines whose price is known, and whether any line had none. */
export function linesTotal(lines: ReadonlyArray<{ quantity: number; price: number | null }>): { total: number; complete: boolean } {
  let total = 0
  let complete = true
  for (const line of lines) {
    if (line.price === null) complete = false
    else total += Math.round(line.quantity * line.price * 100)
  }
  return { total: total / 100, complete }
}

/** Minutes left before the unpaid order expires (rounded up); `expired` once the time has passed. */
export function expiryCountdown(expiresAt: string | null, now: number = Date.now()): { expired: boolean; minutes: number } | null {
  if (!expiresAt) return null
  const remaining = Date.parse(expiresAt) - now
  return remaining <= 0 ? { expired: true, minutes: 0 } : { expired: false, minutes: Math.ceil(remaining / 60_000) }
}

export const ORDER_STATE_TONE: Record<InboxOrderState, StatusTone> = { cart: 'info', ordered: 'warning', dismissed: 'neutral' }
export const PAYMENT_STATUS_TONE: Record<InboxOrderPaymentStatus, StatusTone> = {
  payable: 'warning', processing: 'info', paid: 'success', not_payable: 'neutral', cancelled: 'destructive',
}

/** The one badge of an order: its payment once an online order exists, else its state. */
export function orderBadge(order: { state: InboxOrderState; payment_status: InboxOrderPaymentStatus | null }): { tone: StatusTone; labelKey: string } {
  if (order.state === 'ordered' && order.payment_status) return { tone: PAYMENT_STATUS_TONE[order.payment_status], labelKey: `inbox.orders.payment.${order.payment_status}` }
  return { tone: ORDER_STATE_TONE[order.state], labelKey: `inbox.orders.state.${order.state}` }
}

/** One line of a cart or an order as the screens draw it, whichever shape it came from. */
export interface OrderLineRow {
  key: string | number
  name: string
  retailerId: string
  quantity: number
  /** The price the order charges now; null when the product is not in the catalog. */
  unitPrice: number | null
  /** What the customer's cart said. */
  cartPrice: number | null
  currency: string
  unknown: boolean
  outOfStock: boolean
}

type CartBlock = Extract<InboxMessageCommerce, { type: 'order' }>

/** The lines of a customer's cart as the thread's commerce block carries them. */
export function cartLineRows(block: CartBlock): OrderLineRow[] {
  return block.lines.map((line, index) => ({
    key: index, name: line.product?.name ?? line.product_retailer_id, retailerId: line.product_retailer_id, quantity: line.quantity,
    unitPrice: line.product?.price ?? null, cartPrice: line.item_price, currency: line.currency, unknown: line.product === null, outOfStock: line.product?.availability === 'out_of_stock',
  }))
}

export function orderLineRows(order: Pick<InboxOrder, 'lines'>): OrderLineRow[] {
  return order.lines.map(line => ({
    key: line.id, name: line.name ?? line.product_retailer_id, retailerId: line.product_retailer_id, quantity: line.quantity,
    unitPrice: line.unit_price, cartPrice: line.cart_price, currency: line.currency, unknown: line.catalog_item_id === null, outOfStock: line.availability === 'out_of_stock',
  }))
}

/** The price a line is shown at: today's when the product is known, else what the cart said. */
export const rowPrice = (row: OrderLineRow) => row.unitPrice ?? row.cartPrice
export const rowPriceChanged = (row: OrderLineRow) => row.unitPrice !== null && row.cartPrice !== null && row.unitPrice !== row.cartPrice

export const rowsTotal = (rows: readonly OrderLineRow[]) => linesTotal(rows.map(row => ({ quantity: row.quantity, price: rowPrice(row) })))

/** Whether the cart can still be edited, checked out or dropped. */
export const orderIsCart = (order: { state: InboxOrderState }) => order.state === 'cart'

// ---------------------------------------------------------------- catalog statuses

export const CATALOG_STATE_TONE: Record<InboxCatalogState, StatusTone> = { connected: 'success', error: 'destructive' }
export const SYNC_STATE_TONE: Record<InboxCatalogItemSyncState, StatusTone> = {
  pending: 'warning', syncing: 'info', synced: 'success', error: 'destructive', removing: 'neutral',
}
export const REVIEW_TONE: Record<InboxCatalogItemReview, StatusTone> = { pending: 'warning', approved: 'success', rejected: 'destructive', unknown: 'neutral' }

// ---------------------------------------------------------------- product images

const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const
export const CATALOG_IMAGE_ACCEPT = IMAGE_TYPES.join(',')

export type ImageProblem = 'type' | 'tooLarge' | 'tooSmall'

/** Why a product image would be refused (Meta needs a JPEG or PNG of at least 500 by 500, and LiwanOS caps the size); null when it is fine. */
export function imageProblem(file: { type: string; size: number }, dimensions: { width: number; height: number } | null): ImageProblem | null {
  if (!IMAGE_TYPES.includes(file.type as typeof IMAGE_TYPES[number])) return 'type'
  if (file.size > COMMERCE_LIMITS.imageBytes) return 'tooLarge'
  if (dimensions && (dimensions.width < COMMERCE_LIMITS.imageMinSide || dimensions.height < COMMERCE_LIMITS.imageMinSide)) return 'tooSmall'
  return null
}

/** The pixel size of an image file, read in the browser; null when the file is not a readable image. */
export function measureImage(file: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }) }
    image.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    image.src = url
  })
}
