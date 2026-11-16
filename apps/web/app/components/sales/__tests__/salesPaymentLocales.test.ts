import { describe, expect, it } from 'vitest'
import {
  SalesOrderPaymentAttentionSchema, SalesOrderPaymentHeldSchema, SalesOrderPaymentLinkSchema, SalesOrderPaymentStatusSchema, SalesPublicPaymentStateSchema,
} from '@liwan/contracts'
import ar from '../../../../i18n/locales/ar/sales.json'
import en from '../../../../i18n/locales/en/sales.json'

// Every value the server can send for the payment of a quotation has a word in both languages, so a new value fails here
// and not as a raw key on a customer's page.
const LOCALES = { ar: ar.sales, en: en.sales } as const
const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree)
const missing = (paths: string[]) => Object.entries(LOCALES).flatMap(([locale, tree]) => paths.filter(path => typeof at(tree, path) !== 'string' || at(tree, path) === '').map(path => `${locale}: sales.${path}`))

describe('the payment strings', () => {
  it('has a word for every staff status, link, held and attention value', () => {
    expect(missing([
      ...SalesOrderPaymentStatusSchema.options.map(value => `payment.statuses.${value}`),
      ...SalesOrderPaymentLinkSchema.options.map(value => `payment.links.${value}`),
      ...SalesOrderPaymentHeldSchema.options.map(value => `payment.held.${value}`),
      ...SalesOrderPaymentAttentionSchema.options.map(value => `payment.attention.${value}`),
    ])).toEqual([])
  })

  it('has a title and a body for every customer state that shows a notice', () => {
    expect(missing(SalesPublicPaymentStateSchema.options.filter(value => value !== 'payable').flatMap(value => [`quote.payment.states.${value}.title`, `quote.payment.states.${value}.body`]))).toEqual([])
    expect(missing(['quote.payment.states.received.signBody'])).toEqual([])
  })

  it('reports a missing key by name', () => {
    expect(missing(['payment.statuses.nonexistent'])).toEqual(['ar: sales.payment.statuses.nonexistent', 'en: sales.payment.statuses.nonexistent'])
  })
})
