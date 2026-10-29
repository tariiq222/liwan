import { z } from 'zod'

// Wire shapes of WhatsApp phase 7: catalog and commerce messages.
// - The commerce content of a message (product, product_list, catalog_message) and the `commerce` block of a
//   thread message are WhatsApp wire data serialized by odoo-addons/webvue_inbox (serializers/conversation.py).
//   Their product details and order summary are filled by the bridge odoo-addons/webvue_inbox_payments and are
//   null without it.
// - Catalogs, catalog items, channel commerce settings and orders are served by the bridge
//   (/api/v1/inbox/catalogs, /api/v1/inbox/catalog-items, /api/v1/inbox/channels/<id>/commerce,
//   /api/v1/inbox/orders) behind `inbox.catalog`.
// Every schema mirrors one serializer exactly (strict objects). Text and count limits are Meta's.

const Id = z.number().int().positive()
const UtcDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const list = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  total: z.number().int().nonnegative(),
}).strict()
const Ref = z.object({ id: Id, name: z.string() }).strict()
const MetaId = z.string().regex(/^\d{5,32}$/)
const Currency = z.string().regex(/^[A-Z]{3}$/)
const Amount = z.number().nonnegative()
const HttpsUrl = z.url({ protocol: /^https$/ }).max(2000)

export const INBOX_COMMERCE_LIMITS = {
  header: 60,
  body: 1024,
  footer: 60,
  sectionTitle: 24,
  sections: 10,
  products: 30,
  cartQuantity: 99,
  orderLines: 100,
  retailerId: 100,
  productName: 150,
  productDescription: 5000,
  brand: 100,
  imageMinSide: 500,
  imageBytes: 5 * 1024 * 1024,
} as const
const L = INBOX_COMMERCE_LIMITS

// A product's id in the Meta catalog (Meta `retailer_id`, "Content ID" in Commerce Manager). WebVue uses the
// product's internal reference when it fits, else `wv-<product id>`; it never changes once the item was synced.
export const InboxRetailerIdSchema = z.string().min(1).max(L.retailerId).regex(/^[A-Za-z0-9._-]+$/)
const RetailerId = InboxRetailerIdSchema
// A retailer id as Meta sends it back in a cart or an inquiry: any id of the catalog, also one WebVue did not create.
const WireRetailerId = z.string().min(1).max(L.retailerId)

const Body = z.string().min(1).max(L.body)
const Footer = z.string().min(1).max(L.footer).nullable()

// ---- commerce message content (webvue_inbox) ----

export const InboxProductSectionSchema = z.object({
  title: z.string().min(1).max(L.sectionTitle),
  product_retailer_ids: z.array(RetailerId).min(1).max(L.products),
}).strict()

// What an agent, a rule or an automatic message sends from the channel's catalog: one product; up to 30 products
// in up to 10 titled sections (the header is required); or the whole catalog, with an optional product whose image
// heads the message. Sent only inside the customer-service window, like every interactive message.
export const InboxCommerceContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('product'),
    body: Body.nullable(),
    footer: Footer,
    product_retailer_id: RetailerId,
  }).strict(),
  z.object({
    type: z.literal('product_list'),
    header: z.string().min(1).max(L.header),
    body: Body,
    footer: Footer,
    sections: z.array(InboxProductSectionSchema).min(1).max(L.sections),
  }).strict()
    .refine(
      content => content.sections.reduce((total, section) => total + section.product_retailer_ids.length, 0) <= L.products,
      `a product list holds at most ${L.products} products`,
    )
    .refine(content => {
      const ids = content.sections.flatMap(section => section.product_retailer_ids)
      return new Set(ids).size === ids.length
    }, 'a product appears once in a product list'),
  z.object({
    type: z.literal('catalog_message'),
    body: Body,
    footer: Footer,
    thumbnail_product_retailer_id: RetailerId.nullable(),
  }).strict(),
])

// ---- the commerce block of a thread message ----

export const InboxCatalogAvailabilitySchema = z.enum(['in_stock', 'out_of_stock'])

// A catalog product as the thread shows it now; null without the bridge or when the item is no longer in the catalog.
export const InboxCommerceProductSchema = z.object({
  catalog_item_id: Id,
  name: z.string(),
  price: Amount,
  currency: Currency,
  availability: InboxCatalogAvailabilitySchema,
  image_url: HttpsUrl.nullable(),
}).strict()

const ProductRef = {
  product_retailer_id: WireRetailerId,
  product: InboxCommerceProductSchema.nullable(),
}

// `cart`: received or built, still editable; `ordered`: an online order exists; `dismissed`: dropped by an agent.
export const InboxOrderStateSchema = z.enum(['cart', 'ordered', 'dismissed'])
// The payer's status of the online order (webvue.payments.service summary), or `cancelled` (expired or cancelled).
export const InboxOrderPaymentStatusSchema = z.enum(['payable', 'processing', 'paid', 'not_payable', 'cancelled'])

export const InboxOrderSummarySchema = z.object({
  id: Id,
  state: InboxOrderStateSchema,
  // The sale order number (for example S00012) once ordered.
  reference: z.string().nullable(),
  payment_status: InboxOrderPaymentStatusSchema.nullable(),
}).strict()

// `sent`: an outbound product, product list or catalog message, with the products it names in content order.
// `order`: the customer's cart as WhatsApp sent it, and the WebVue order made from it.
// `inquiry`: the customer's text sent from a product ("Message business").
export const InboxMessageCommerceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sent'),
    catalog_id: MetaId,
    content: InboxCommerceContentSchema,
    products: z.array(z.object(ProductRef).strict()),
  }).strict(),
  z.object({
    type: z.literal('order'),
    catalog_id: MetaId,
    text: z.string().nullable(),
    lines: z.array(z.object({
      ...ProductRef,
      quantity: z.number().int().positive(),
      item_price: Amount,
      currency: Currency,
    }).strict()).min(1),
    order: InboxOrderSummarySchema.nullable(),
  }).strict(),
  z.object({
    type: z.literal('inquiry'),
    catalog_id: MetaId,
    ...ProductRef,
  }).strict(),
])

// ---- catalogs (bridge) ----

export const InboxCatalogStateSchema = z.enum(['connected', 'error'])

// One phone number of the catalog's WhatsApp account: Meta's commerce settings, null until first read.
export const InboxCatalogChannelSchema = z.object({
  id: Id,
  name: z.string(),
  cart_enabled: z.boolean().nullable(),
  catalog_visible: z.boolean().nullable(),
}).strict()

export const InboxCatalogSchema = z.object({
  id: Id,
  business_account_id: MetaId,
  meta_catalog_id: MetaId,
  name: z.string(),
  state: InboxCatalogStateSchema,
  last_error: z.string().nullable(),
  brand: z.string().min(1).max(L.brand),
  // The product page link Meta requires; null sends the click-to-chat link of the item's WhatsApp number.
  default_link: HttpsUrl.nullable(),
  prices_include_tax: z.boolean(),
  currency: Currency,
  channels: z.array(InboxCatalogChannelSchema),
  counts: z.object({
    items: z.number().int().nonnegative(),
    synced: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }).strict(),
  last_sync_at: UtcDateTime.nullable(),
  created_at: UtcDateTime,
}).strict()
export const InboxCatalogListSchema = list(InboxCatalogSchema)

const CatalogFields = {
  brand: z.string().trim().min(1).max(L.brand),
  default_link: HttpsUrl.nullable(),
  prices_include_tax: z.boolean(),
}

// Connect the catalog made in Commerce Manager to the WhatsApp account of `channel_id`. `connect: false` when it
// is already connected in WhatsApp Manager; the server checks it either way.
export const InboxCatalogCreateSchema = z.object({
  channel_id: Id,
  meta_catalog_id: MetaId,
  connect: z.boolean(),
  ...CatalogFields,
}).strict()

export const InboxCatalogPatchSchema = z.object(CatalogFields).partial().strict()
  .refine(body => Object.keys(body).length > 0, { message: 'send at least one field' })

// Meta's commerce settings of one phone number, and the catalog its WhatsApp account uses (null: none connected).
export const InboxChannelCommerceSchema = z.object({
  channel_id: Id,
  catalog: Ref.nullable(),
  cart_enabled: z.boolean().nullable(),
  catalog_visible: z.boolean().nullable(),
  // Sent to the customer when an order is paid, inside the service window only; {reference} is the order number.
  paid_notice_enabled: z.boolean(),
  paid_notice_text: z.string(),
}).strict()

export const InboxChannelCommercePatchSchema = z.object({
  cart_enabled: z.boolean().optional(),
  catalog_visible: z.boolean().optional(),
  paid_notice_enabled: z.boolean().optional(),
  paid_notice_text: z.string().trim().min(1).max(L.body).optional(),
}).strict().refine(body => Object.keys(body).length > 0, { message: 'send at least one field' })

// ---- catalog items (bridge) ----

export const InboxCatalogItemSyncStateSchema = z.enum(['pending', 'syncing', 'synced', 'error', 'removing'])
export const InboxCatalogItemReviewSchema = z.enum(['pending', 'approved', 'rejected', 'unknown'])

export const InboxCatalogImageSchema = z.object({
  url: HttpsUrl,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict()

export const InboxCatalogItemSchema = z.object({
  id: Id,
  catalog_id: Id,
  product: Ref,
  product_retailer_id: RetailerId,
  name: z.string(),
  description: z.string(),
  // The sales price stored in WebVue (before taxes), and the price the catalog shows (`price`, taxes per the catalog).
  list_price: Amount,
  price: Amount,
  currency: Currency,
  availability: InboxCatalogAvailabilitySchema,
  listed: z.boolean(),
  link: HttpsUrl,
  link_override: HttpsUrl.nullable(),
  image: InboxCatalogImageSchema.nullable(),
  sync_state: InboxCatalogItemSyncStateSchema,
  sync_error: z.string().nullable(),
  review_status: InboxCatalogItemReviewSchema,
  review_reason: z.string().nullable(),
  last_synced_at: UtcDateTime.nullable(),
}).strict()
export const InboxCatalogItemListSchema = list(InboxCatalogItemSchema)

// A product image uploaded as base64 JSON like every WebVue attachment: JPEG or PNG, at least 500×500, at most 5 MB.
export const InboxCatalogImageUploadSchema = z.object({
  name: z.string().min(1).max(255),
  mimetype: z.enum(['image/jpeg', 'image/png']),
  data: z.string().min(1),
}).strict()

const ProductFields = {
  name: z.string().trim().min(1).max(L.productName),
  description: z.string().trim().min(1).max(L.productDescription).nullable(),
  list_price: Amount,
}

// A new product made for the catalog: it needs an image (Meta requires one).
export const InboxCatalogProductCreateSchema = z.object({
  ...ProductFields,
  image: InboxCatalogImageUploadSchema,
}).strict()

export const InboxCatalogProductPatchSchema = z.object({
  ...ProductFields,
  image: InboxCatalogImageUploadSchema,
}).partial().strict().refine(body => Object.keys(body).length > 0, { message: 'send at least one field' })

const ItemFields = {
  // Defaults to the product's internal reference or `wv-<product id>`; fixed once the item was synced.
  product_retailer_id: RetailerId.optional(),
  availability: InboxCatalogAvailabilitySchema.optional(),
  listed: z.boolean().optional(),
  link_override: HttpsUrl.nullable().optional(),
}

// List an existing product (it must have an image), or make a new one.
export const InboxCatalogItemCreateSchema = z.union([
  z.object({ product_id: Id, ...ItemFields }).strict(),
  z.object({ product: InboxCatalogProductCreateSchema, ...ItemFields }).strict(),
])

// `product` edits only a product made by the catalog editor (422 otherwise).
export const InboxCatalogItemPatchSchema = z.object({
  ...ItemFields,
  product: InboxCatalogProductPatchSchema.optional(),
}).strict().refine(body => Object.keys(body).length > 0, { message: 'send at least one field' })

// An existing product of the catalog's company that may be listed: the "existing product" picker of the item form.
export const InboxCatalogProductOptionSchema = z.object({
  id: Id,
  name: z.string(),
  list_price: Amount,
  currency: Currency,
  // Meta needs an image; a product without one cannot be listed until it gets one.
  has_image: z.boolean(),
  // Already an item of this catalog.
  listed: z.boolean(),
}).strict()
export const InboxCatalogProductOptionListSchema = list(InboxCatalogProductOptionSchema)

// What the composer's product picker lists: listed, synced, not rejected items of the conversation's catalog.
export const InboxCatalogPickItemSchema = z.object({
  id: Id,
  product_retailer_id: RetailerId,
  name: z.string(),
  price: Amount,
  currency: Currency,
  availability: InboxCatalogAvailabilitySchema,
  image_url: HttpsUrl.nullable(),
}).strict()
export const InboxCatalogPickItemListSchema = list(InboxCatalogPickItemSchema)

// ---- orders (bridge) ----

// The payment of the online order (webvue.payments.service summary). `refund_due`: money was received that must be
// given back; `needs_attention`: money was received but not recorded on the order for an hour.
export const InboxOrderPaymentSchema = z.object({
  status: InboxOrderPaymentStatusSchema,
  refund_due: z.boolean(),
  needs_attention: z.boolean(),
  currency: Currency,
  amount_total: Amount,
  amount_due: Amount,
  expires_at: UtcDateTime.nullable(),
}).strict()

export const InboxOrderLineSchema = z.object({
  id: Id,
  product_retailer_id: WireRetailerId,
  // Null when the retailer id is not an item of the catalog: the order cannot be checked out until it is removed.
  catalog_item_id: Id.nullable(),
  name: z.string().nullable(),
  quantity: z.number().int().min(1).max(L.cartQuantity),
  // What the customer's cart said, and the price the order will charge now (taxes per the catalog).
  cart_price: Amount.nullable(),
  unit_price: Amount.nullable(),
  currency: Currency,
  availability: InboxCatalogAvailabilitySchema.nullable(),
}).strict()

export const InboxOrderSchema = z.object({
  id: Id,
  conversation_id: Id,
  channel: Ref,
  contact: Ref,
  // The customer's cart message; null for an order an agent built.
  message_id: Id.nullable(),
  state: InboxOrderStateSchema,
  reference: z.string().nullable(),
  lines: z.array(InboxOrderLineSchema),
  cart_total: Amount.nullable(),
  cart_currency: Currency.nullable(),
  // The total at today's prices; `price_changed` when it differs from the cart's.
  total: Amount,
  currency: Currency,
  price_changed: z.boolean(),
  payment: InboxOrderPaymentSchema.nullable(),
  pay_link_sent_at: UtcDateTime.nullable(),
  created_by: Ref.nullable(),
  created_at: UtcDateTime,
}).strict()
export const InboxOrderListSchema = list(InboxOrderSchema)

const Quantity = z.number().int().min(1).max(L.cartQuantity)

// An order an agent builds for the customer from catalog items.
export const InboxOrderCreateSchema = z.object({
  lines: z.array(z.object({ catalog_item_id: Id, quantity: Quantity }).strict()).min(1).max(L.orderLines),
}).strict()

// The full new line list of a cart: an existing line by id, or a new catalog item. Lines left out are removed.
export const InboxOrderPatchSchema = z.object({
  lines: z.array(z.union([
    z.object({ id: Id, quantity: Quantity }).strict(),
    z.object({ catalog_item_id: Id, quantity: Quantity }).strict(),
  ])).min(1).max(L.orderLines),
}).strict()

// Create the online order (once) and send its pay link: a link button inside the window, or `template_id` (an
// approved template whose one url button ends in a variable after `<origin>/pay/order/`) once it has closed.
export const InboxOrderCheckoutSchema = z.object({
  template_id: Id.optional(),
  body: Body.optional(),
}).strict()

export const InboxOrderCheckoutResultSchema = z.object({
  order: InboxOrderSchema,
  message_id: Id,
}).strict()

export type InboxRetailerId = z.infer<typeof InboxRetailerIdSchema>
export type InboxProductSection = z.infer<typeof InboxProductSectionSchema>
export type InboxCommerceContent = z.infer<typeof InboxCommerceContentSchema>
export type InboxCatalogAvailability = z.infer<typeof InboxCatalogAvailabilitySchema>
export type InboxCommerceProduct = z.infer<typeof InboxCommerceProductSchema>
export type InboxOrderState = z.infer<typeof InboxOrderStateSchema>
export type InboxOrderPaymentStatus = z.infer<typeof InboxOrderPaymentStatusSchema>
export type InboxOrderSummary = z.infer<typeof InboxOrderSummarySchema>
export type InboxMessageCommerce = z.infer<typeof InboxMessageCommerceSchema>
export type InboxCatalogState = z.infer<typeof InboxCatalogStateSchema>
export type InboxCatalogChannel = z.infer<typeof InboxCatalogChannelSchema>
export type InboxCatalog = z.infer<typeof InboxCatalogSchema>
export type InboxCatalogList = z.infer<typeof InboxCatalogListSchema>
export type InboxCatalogCreate = z.infer<typeof InboxCatalogCreateSchema>
export type InboxCatalogPatch = z.infer<typeof InboxCatalogPatchSchema>
export type InboxChannelCommerce = z.infer<typeof InboxChannelCommerceSchema>
export type InboxChannelCommercePatch = z.infer<typeof InboxChannelCommercePatchSchema>
export type InboxCatalogItemSyncState = z.infer<typeof InboxCatalogItemSyncStateSchema>
export type InboxCatalogItemReview = z.infer<typeof InboxCatalogItemReviewSchema>
export type InboxCatalogImage = z.infer<typeof InboxCatalogImageSchema>
export type InboxCatalogItem = z.infer<typeof InboxCatalogItemSchema>
export type InboxCatalogItemList = z.infer<typeof InboxCatalogItemListSchema>
export type InboxCatalogImageUpload = z.infer<typeof InboxCatalogImageUploadSchema>
export type InboxCatalogProductCreate = z.infer<typeof InboxCatalogProductCreateSchema>
export type InboxCatalogProductPatch = z.infer<typeof InboxCatalogProductPatchSchema>
export type InboxCatalogItemCreate = z.infer<typeof InboxCatalogItemCreateSchema>
export type InboxCatalogItemPatch = z.infer<typeof InboxCatalogItemPatchSchema>
export type InboxCatalogProductOption = z.infer<typeof InboxCatalogProductOptionSchema>
export type InboxCatalogPickItem = z.infer<typeof InboxCatalogPickItemSchema>
export type InboxCatalogPickItemList = z.infer<typeof InboxCatalogPickItemListSchema>
export type InboxOrderPayment = z.infer<typeof InboxOrderPaymentSchema>
export type InboxOrderLine = z.infer<typeof InboxOrderLineSchema>
export type InboxOrder = z.infer<typeof InboxOrderSchema>
export type InboxOrderList = z.infer<typeof InboxOrderListSchema>
export type InboxOrderCreate = z.infer<typeof InboxOrderCreateSchema>
export type InboxOrderPatch = z.infer<typeof InboxOrderPatchSchema>
export type InboxOrderCheckout = z.infer<typeof InboxOrderCheckoutSchema>
export type InboxOrderCheckoutResult = z.infer<typeof InboxOrderCheckoutResultSchema>
