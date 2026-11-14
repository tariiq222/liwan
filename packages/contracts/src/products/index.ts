import { z } from 'zod'

// liwan_products: the tenant's products on product.template, owned by one shared service, plus the sale taxes of the
// bridge liwan_products_account. Field for field with odoo-addons/liwan_products/serializers/{product,settings}.py and
// odoo-addons/liwan_products_account/{controllers,serializers,models}.

const Id = z.number().int().positive()
const RefSchema = z.object({ id: Id, name: z.string() }).strict()
const Amount = z.number().nonnegative()

export const PRODUCT_LIMITS = { name: 200, description: 4000 } as const

export const ProductSharingSchema = z.enum(['establishment', 'branch'])

/** `goods` is stock's `consu`; a combo has no editor yet. */
export const ProductTypeSchema = z.enum(['goods', 'service'])

export const ProductCurrencySchema = z.object({
  id: Id,
  name: z.string().min(1),
  symbol: z.string(),
}).strict()

const PriceFields = {
  // The price as typed on the product, then the amounts of one unit: before tax, the tax, and the total the customer pays.
  unit_price: Amount,
  amount_untaxed: Amount,
  amount_tax: Amount,
  amount_total: Amount,
  currency: ProductCurrencySchema,
}

/** The price of one unit in the session's company. */
export const ProductPriceSchema = z.object(PriceFields).strict()

/** A sale tax a product carries. */
export const ProductTaxSchema = z.object({
  id: Id,
  name: z.string(),
  amount: z.number(),
}).strict()

/**
 * A service product on the wire. `taxes` is present only for an establishment registered for VAT, so the key may be
 * missing. `company` is null for a product shared by every branch.
 */
export const ProductSchema = z.object({
  id: Id,
  name: z.string().min(1),
  type: ProductTypeSchema,
  description: z.string().nullable(),
  list_price: Amount,
  price: ProductPriceSchema,
  company: RefSchema.nullable(),
  active: z.boolean(),
  taxes: z.array(ProductTaxSchema).optional(),
}).strict()

export const ProductListSchema = z.object({
  items: z.array(ProductSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** What a holder of a pick capability sees of a product (`GET /api/v1/products/pick`): its name, type and the amounts of one unit. */
export const ProductPickSchema = z.object({
  id: Id,
  name: z.string().min(1),
  type: ProductTypeSchema,
  ...PriceFields,
}).strict()

export const ProductPickListSchema = z.object({
  items: z.array(ProductPickSchema),
  total: z.number().int().nonnegative(),
}).strict()

const DefinitionFields = {
  name: z.string().trim().min(1).max(PRODUCT_LIMITS.name),
  type: ProductTypeSchema,
  // The price is `products.prices.manage`; the rest of the definition is `products.manage`.
  list_price: Amount,
  description: z.string().max(PRODUCT_LIMITS.description).nullable(),
  // The establishment's own sale taxes (`ProductTaxChoiceSchema` ids): accepted only when it is registered for VAT.
  taxes: z.array(Id).min(1),
}

export const ProductCreateSchema = z.object({
  name: DefinitionFields.name,
  type: DefinitionFields.type,
  list_price: DefinitionFields.list_price.optional(),
  description: DefinitionFields.description.optional(),
  taxes: DefinitionFields.taxes.optional(),
}).strict()

export const ProductPatchSchema = z.object(DefinitionFields).partial().strict()
  .refine(patch => Object.keys(patch).length > 0, { message: 'nothing to change' })

/** A sale tax a new product may carry; `active: false` means picking it activates it. */
export const ProductTaxChoiceSchema = z.object({
  id: Id,
  name: z.string(),
  amount: z.number(),
  active: z.boolean(),
}).strict()

export const ProductTaxChoiceListSchema = z.object({
  items: z.array(ProductTaxChoiceSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ProductSettingsSchema = z.object({
  sharing: ProductSharingSchema,
  // Whether this session may change the settings: the capability in the working company and in the root company.
  can_manage: z.boolean(),
  revision: z.number().int().positive(),
}).strict()

export const ProductSettingsPatchSchema = z.object({
  sharing: ProductSharingSchema,
  revision: z.number().int().positive(),
}).strict()

export type ProductSharing = z.infer<typeof ProductSharingSchema>
export type ProductType = z.infer<typeof ProductTypeSchema>
export type ProductCurrency = z.infer<typeof ProductCurrencySchema>
export type ProductPrice = z.infer<typeof ProductPriceSchema>
export type ProductTax = z.infer<typeof ProductTaxSchema>
export type Product = z.infer<typeof ProductSchema>
export type ProductList = z.infer<typeof ProductListSchema>
export type ProductPick = z.infer<typeof ProductPickSchema>
export type ProductPickList = z.infer<typeof ProductPickListSchema>
export type ProductCreate = z.infer<typeof ProductCreateSchema>
export type ProductPatch = z.infer<typeof ProductPatchSchema>
export type ProductTaxChoice = z.infer<typeof ProductTaxChoiceSchema>
export type ProductTaxChoiceList = z.infer<typeof ProductTaxChoiceListSchema>
export type ProductSettings = z.infer<typeof ProductSettingsSchema>
export type ProductSettingsPatch = z.infer<typeof ProductSettingsPatchSchema>
