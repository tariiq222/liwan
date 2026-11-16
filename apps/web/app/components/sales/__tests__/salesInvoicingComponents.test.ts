import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import { SalesInvoiceActorSchema, SalesInvoiceDownPaymentSchema, SalesInvoiceKindSchema, SalesInvoicePaymentStateSchema, SalesInvoiceStateSchema, SalesInvoicingStatusSchema } from '@liwan/contracts'
import * as salesInvoicing from '../../../utils/salesInvoicing'
import arFinance from '../../../../i18n/locales/ar/finance-documents.json'
import enFinance from '../../../../i18n/locales/en/finance-documents.json'
import ar from '../../../../i18n/locales/ar/sales.json'
import en from '../../../../i18n/locales/en/sales.json'

const link = Vue.defineComponent({ inheritAttrs: false, props: ['to'], setup: (props, { attrs, slots }) => () => Vue.h('a', { href: typeof props.to === 'string' ? props.to : `${props.to.path}?returnTo=${props.to.query.returnTo}`, 'data-testid': attrs['data-testid'] }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label', 'tone'], setup: props => () => Vue.h('span', { 'data-badge': props.label, 'data-tone': props.tone }) })
const section = Vue.defineComponent({ props: ['title'], setup: (props, { slots }) => () => Vue.h('section', [Vue.h('h2', props.title), slots.default?.()]) })
const card = Vue.defineComponent({ props: ['title'], setup: (props, { slots }) => () => Vue.h('section', [props.title, slots.default?.()]) })
const field = Vue.defineComponent({ props: ['label'], setup: (props, { slots }) => () => Vue.h('div', [props.label, slots.default?.()]) })
const option = Vue.defineComponent({
  props: ['options', 'disabled', 'modelValue'],
  setup: (props, { attrs }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'], 'data-disabled': String(props.disabled) }, (props.options as { value: string; label: string }[]).map(item => Vue.h('i', { 'data-option': item.value }, item.label))),
})

const messages: Record<string, string> = {
  'sales.invoicing.title': 'الفواتير', 'sales.invoicing.online': 'يُفوتر الطلب الإلكتروني عند دفعه', 'sales.invoicing.empty': 'لا فاتورة بعد', 'sales.invoicing.draftNumber': 'مسودة',
  'sales.invoicing.amounts.invoiced': 'المفوتر', 'sales.invoicing.amounts.drafted': 'في فواتير مسودة', 'sales.invoicing.amounts.credited': 'إشعارات دائنة', 'sales.invoicing.amounts.toInvoice': 'المتبقي للفوترة', 'sales.invoicing.amounts.paid': 'المدفوع',
}
for (const value of SalesInvoicingStatusSchema.options) messages[`sales.invoicing.status.${value}`] = `status-${value}`
for (const value of SalesInvoiceKindSchema.options) messages[`sales.invoicing.kinds.${value}`] = `kind-${value}`
for (const value of SalesInvoiceStateSchema.options) messages[`sales.invoicing.states.${value}`] = `state-${value}`
for (const value of SalesInvoicePaymentStateSchema.options) messages[`sales.invoicing.paymentStates.${value}`] = `pay-${value}`
const render = (props: Record<string, unknown>) => renderShared(resolve(import.meta.dirname, '../SalesOrderInvoicing.vue'), props, {}, {
  hydrated: true, messages, stubs: { NuxtLink: link, SharedStatusBadge: badge, SharedRecordSection: section },
  modules: {
    '@liwan/ui/app/utils/formatDate': { formatDate: (day: string) => day },
    '@/utils/formatCurrency': { formatCurrency: (amount: number, currency: string) => `${amount} ${currency}` },
    '@/utils/salesInvoicing': salesInvoicing,
  },
})

const draft = { id: 9002, number: null, state: 'draft', kind: 'invoice', payment_state: 'not_paid', invoice_date: null, invoice_date_due: '2026-12-15', amount_total: 173.88, amount_residual: 173.88, currency: 'SAR' }
const posted = { id: 9001, number: 'INV/2026/00041', state: 'posted', kind: 'down_payment', payment_state: 'partial', invoice_date: '2026-11-15', invoice_date_due: '2026-12-15', amount_total: 74.52, amount_residual: 34.52, currency: 'SAR' }
const credit = { ...posted, id: 9003, number: 'RINV/2026/00002', kind: 'credit_note', payment_state: 'paid', amount_residual: 0 }
const invoicing = { status: 'partial', amount_invoiced: 74.52, amount_credited: 0, amount_drafted: 173.88, amount_to_invoice: 0, amount_paid: 40, invoices: [draft, posted], can_invoice: false, can_down_payment: false }

describe('SalesOrderInvoicing', () => {
  it('lists each invoice with its state, kind and total, linking to finance and back to the order', async () => {
    const html = await render({ invoicing, currency: 'SAR', orderId: 2 })
    expect(html).toContain('href="/finance/sales/invoices/9002?returnTo=/sales/2"')
    expect(html).toContain('href="/finance/sales/invoices/9001?returnTo=/sales/2"')
    expect(html).toContain('INV/2026/00041')
    expect(html).toContain('مسودة')
    for (const badgeLabel of ['status-partial', 'kind-invoice', 'kind-down_payment', 'state-draft', 'state-posted', 'pay-partial']) expect(html).toContain(`data-badge="${badgeLabel}"`)
    expect(html).not.toContain('data-badge="pay-not_paid"')
    expect(html).not.toContain('sales-invoicing-empty')
  })

  it('links a credit note to the finance credit notes', async () => {
    const html = await render({ invoicing: { ...invoicing, amount_credited: 74.52, invoices: [credit, posted] }, currency: 'SAR', orderId: 2 })
    expect(html).toContain('href="/finance/sales/credit-notes/9003?returnTo=/sales/2"')
    expect(html).toContain('data-testid="sales-invoicing-credited"')
  })

  it('shows the three amounts that always matter and the others only when they are above zero', async () => {
    const empty = await render({ invoicing: { status: 'to_invoice', amount_invoiced: 0, amount_credited: 0, amount_drafted: 0, amount_to_invoice: 248.4, amount_paid: 0, invoices: [], can_invoice: true, can_down_payment: true }, currency: 'SAR', orderId: 2 })
    for (const key of ['invoiced', 'toInvoice', 'paid']) expect(empty).toContain(`data-testid="sales-invoicing-${key}"`)
    for (const key of ['drafted', 'credited']) expect(empty).not.toContain(`data-testid="sales-invoicing-${key}"`)
    expect(empty).toContain('data-testid="sales-invoicing-empty"')
    const full = await render({ invoicing, currency: 'SAR', orderId: 2 })
    expect(full).toContain('data-testid="sales-invoicing-drafted"')
  })

  it('says why an online order has no invoice here', async () => {
    expect(await render({ invoicing, currency: 'SAR', orderId: 4, online: true })).toContain('يُفوتر الطلب الإلكتروني عند دفعه')
    expect(await render({ invoicing, currency: 'SAR', orderId: 2 })).not.toContain('sales-invoicing-online')
  })
})

const renderCard = (props: Record<string, unknown>) => renderShared(resolve(import.meta.dirname, '../settings/SalesInvoicingCard.vue'), props, {}, {
  hydrated: true,
  messages: Object.fromEntries(['allow', 'refuse', 'owner', 'any_biller'].flatMap(value => [[`sales.settings.invoicing.${value}`, `l-${value}`], [`sales.settings.invoicing.${value}Hint`, `h-${value}`]])),
  stubs: { SharedSettingsCard: card, UFormField: field, SharedOptionCards: option },
  modules: { '@/composables/sales/useSalesSettingsCard': { useSalesSettingsCard: () => ({ draft: Vue.ref({ invoice_down_payment: 'allow', invoice_actor: 'owner' }), state: Vue.ref({ saving: false, reloading: false }), save: () => {}, revert: () => {}, reload: () => {} }) } },
})
const settings = { invoice_down_payment: 'allow', invoice_actor: 'owner', revision: 1, can_manage: true }

describe('SalesInvoicingCard', () => {
  it('offers both choices and is read only for a caller who cannot manage the settings', async () => {
    const editable = await renderCard({ settings, canEdit: true, reloadSettings: async () => settings })
    for (const value of ['allow', 'refuse', 'owner', 'any_biller']) expect(editable).toContain(`data-option="${value}"`)
    expect(editable).toContain('data-testid="sales-invoicing-down-payment" data-disabled="false"')
    expect(editable).toContain('data-testid="sales-invoicing-actor" data-disabled="false"')
    const readOnly = await renderCard({ settings, canEdit: false, reloadSettings: async () => settings })
    expect(readOnly).toContain('data-testid="sales-invoicing-down-payment" data-disabled="true"')
    expect(readOnly).toContain('data-testid="sales-invoicing-actor" data-disabled="true"')
  })
})

// Every value the server can send has a word in both languages, so a new one fails here and not as a raw key on a page.
const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree)
const missing = (tree: unknown, locale: string, paths: string[]) => paths.filter(path => typeof at(tree, path) !== 'string' || at(tree, path) === '').map(path => `${locale}: ${path}`)

describe('the invoicing strings', () => {
  it('has a word for every status, kind, state, payment state and setting choice, in both languages', () => {
    const paths = [
      ...SalesInvoicingStatusSchema.options.map(value => `invoicing.status.${value}`),
      ...SalesInvoiceKindSchema.options.map(value => `invoicing.kinds.${value}`),
      ...SalesInvoiceStateSchema.options.map(value => `invoicing.states.${value}`),
      ...SalesInvoicePaymentStateSchema.options.map(value => `invoicing.paymentStates.${value}`),
      ...[...SalesInvoiceDownPaymentSchema.options, ...SalesInvoiceActorSchema.options].flatMap(value => [`settings.invoicing.${value}`, `settings.invoicing.${value}Hint`]),
      ...['actor', 'actorHint'].map(value => `settings.invoicing.${value}`),
      'invoicing.cancelBlocked', 'invoicing.cancelBlockedDraft',
      ...['invoiced', 'credited', 'drafted', 'toInvoice', 'paid'].map(value => `invoicing.amounts.${value}`),
      ...['percent', 'amount', 'notConfirmed', 'nothingToInvoice', 'downPaymentRefused', 'noJournal', 'online', 'notSalesperson', 'financeNotIncluded'].map(value => `invoicing.errors.${value}`),
    ]
    expect([...missing(ar.sales, 'ar', paths), ...missing(en.sales, 'en', paths)]).toEqual([])
  })

  it('names the order an invoice came from in finance, in both languages', () => {
    expect([...missing(arFinance.financeDocuments, 'ar', ['record.sourceOrder']), ...missing(enFinance.financeDocuments, 'en', ['record.sourceOrder'])]).toEqual([])
  })

  it('uses no em dash', () => {
    for (const tree of [ar.sales.invoicing, en.sales.invoicing, ar.sales.settings.invoicing, en.sales.settings.invoicing]) expect(JSON.stringify(tree)).not.toContain('—')
  })
})
