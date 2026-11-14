import type { Customer } from '@liwan/contracts'

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * The name a screen shows for a customer. An erased customer keeps a stored language-neutral marker as its `name`,
 * so the screen shows its own translated name with the customer's number instead of the marker.
 */
export function customerName(customer: Pick<Customer, 'id' | 'name' | 'erased'>, t: Translate): string {
  return customer.erased ? t('customers.erasedName', { id: customer.id }) : customer.name
}
