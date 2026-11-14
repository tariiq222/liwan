import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Product } from '@liwan/contracts'

/** Why the session cannot write a product (D23): a shared product is written from the root company, a branch's own product from that branch. */
export type ProductManagedElsewhere = 'managed_in_root_company' | 'managed_in_branch'

interface WorkingSession { is_root_company: boolean; company: { id: number } }

/** Where the session's company stands against the product's owner, or null when this session may write it. */
export function productManagedElsewhere(product: Pick<Product, 'company'>, session: WorkingSession): ProductManagedElsewhere | null {
  if (product.company === null) return session.is_root_company ? null : 'managed_in_root_company'
  return product.company.id === session.company.id ? null : 'managed_in_branch'
}

/** `productManagedElsewhere` for the signed-in session; null while either is not loaded. */
export function useProductManagedElsewhere(product: MaybeRefOrGetter<Pick<Product, 'company'> | null | undefined>) {
  const { me } = useMe()
  return computed(() => {
    const current = toValue(product)
    return current && me.value ? productManagedElsewhere(current, me.value) : null
  })
}
