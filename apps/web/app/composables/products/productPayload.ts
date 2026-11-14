import type { Product, ProductCreate, ProductImage, ProductPatch, ProductType } from '@liwan/contracts'

/** The image the user did with the file: nothing, took a new one, or removed the stored one. */
export type ProductImageChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'set'; image: ProductImage }

/** What the product form holds. `taxId` is null until the user picks a tax; `price` is null while the field is empty. */
export interface ProductDraft {
  name: string
  type: ProductType
  description: string
  price: number | null
  taxId: number | null
  image: ProductImageChange
}

/** What the session may write: the definition (`products.manage`) and the price (`products.prices.manage`) are separate rights. */
export interface ProductAbilities { manage: boolean; prices: boolean }

const trimmed = (value: string) => value.trim() || null

/** The create body: the price only for a holder of the price right, an empty description or no tax or image left out. */
export function productCreateBody(draft: ProductDraft, abilities: ProductAbilities): ProductCreate {
  const description = trimmed(draft.description)
  return {
    name: draft.name.trim(),
    type: draft.type,
    ...(abilities.prices && draft.price !== null ? { list_price: draft.price } : {}),
    ...(description ? { description } : {}),
    ...(draft.image.kind === 'set' ? { image: draft.image.image } : {}),
    ...(draft.taxId !== null ? { taxes: [draft.taxId] } : {}),
  }
}

function definitionPatch(product: Product, draft: ProductDraft): ProductPatch {
  const patch: ProductPatch = {}
  if (draft.name.trim() !== product.name) patch.name = draft.name.trim()
  if (draft.type !== product.type) patch.type = draft.type
  if (trimmed(draft.description) !== product.description) patch.description = trimmed(draft.description)
  if (draft.image.kind === 'set') patch.image = draft.image.image
  if (draft.image.kind === 'remove') patch.image = null
  // A product that carries several taxes is rewritten only when the user picks one; the same single tax is no change.
  const current = product.taxes ?? []
  if (draft.taxId !== null && !(current.length === 1 && current[0]!.id === draft.taxId)) patch.taxes = [draft.taxId]
  return patch
}

/**
 * The edit body: only what differs from the saved product. A holder of the price right alone sends `list_price` and
 * nothing else; a holder of the definition right alone never sends the price.
 */
export function productPatchBody(product: Product, draft: ProductDraft, abilities: ProductAbilities): ProductPatch {
  const patch: ProductPatch = abilities.manage ? definitionPatch(product, draft) : {}
  if (abilities.prices && draft.price !== null && draft.price !== product.list_price) patch.list_price = draft.price
  return patch
}
