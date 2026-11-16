import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import { SalesOpportunityWinAmountSchema, SalesOpportunityWinSchema } from '@liwan/contracts'
import arCrm from '../../../../i18n/locales/ar/crm.json'
import enCrm from '../../../../i18n/locales/en/crm.json'
import ar from '../../../../i18n/locales/ar/sales.json'
import en from '../../../../i18n/locales/en/sales.json'

const link = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to, 'data-testid': attrs['data-testid'] }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label'], setup: props => () => Vue.h('span', { 'data-badge': props.label }) })
const panel = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', slots.default?.()) })
const row = Vue.defineComponent({ props: ['label', 'value'], setup: (props, { slots }) => () => Vue.h('div', [props.label, ' ', props.value, slots.default?.()]) })
const messages = {
  'sales.record.opportunity': 'الفرصة', 'sales.record.opportunityStatusLabel': 'حالة الفرصة', 'sales.record.opportunityArchived': 'مؤرشفة',
  'sales.record.opportunityStatus.pending': 'مفتوحة', 'sales.record.opportunityStatus.won': 'مربوحة', 'sales.record.opportunityStatus.lost': 'خاسرة',
}
const render = (props: Record<string, unknown>) => renderShared(resolve(import.meta.dirname, '../SalesOrderOpportunity.vue'), props, {}, {
  hydrated: true, messages, stubs: { NuxtLink: link, SharedStatusBadge: badge, SharedPropertiesPanel: panel, SharedPropertyRow: row },
})

const opportunity = { id: 5, contact_name: 'فهد الحربي', status: 'pending', active: true }

const option = Vue.defineComponent({
  props: ['options', 'disabled', 'modelValue'],
  setup: (props, { attrs }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'], 'data-disabled': String(props.disabled) }, (props.options as { value: string; label: string }[]).map(item => Vue.h('i', { 'data-option': item.value }, item.label))),
})
const card = Vue.defineComponent({ props: ['title'], setup: (props, { slots }) => () => Vue.h('section', [props.title, slots.default?.()]) })
const field = Vue.defineComponent({ props: ['label'], setup: (props, { slots }) => () => Vue.h('div', [props.label, slots.default?.()]) })
const renderCard = (props: Record<string, unknown>) => renderShared(resolve(import.meta.dirname, '../settings/SalesOpportunityCard.vue'), props, {}, {
  hydrated: true,
  messages: Object.fromEntries(['order_confirmed', 'manual', 'untaxed', 'total'].flatMap(value => [[`sales.settings.opportunity.${value}`, `l-${value}`], [`sales.settings.opportunity.${value}Hint`, `h-${value}`]])),
  stubs: { SharedSettingsCard: card, UFormField: field, SharedOptionCards: option },
  modules: { '@/composables/sales/useSalesSettingsCard': { useSalesSettingsCard: () => ({ draft: Vue.ref({ opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed' }), state: Vue.ref({ saving: false, reloading: false }), save: () => {}, revert: () => {}, reload: () => {} }) } },
})
const settings = { opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed', revision: 1, can_manage: true }

describe('SalesOpportunityCard', () => {
  it('offers both choices of when an order wins and both of the amount', async () => {
    const html = await renderCard({ settings, canEdit: true, reloadSettings: async () => settings })
    for (const value of ['order_confirmed', 'manual', 'untaxed', 'total']) expect(html).toContain(`data-option="${value}"`)
    expect(html).toContain('l-manual')
    expect(html).toContain('data-testid="sales-opportunity-win" data-disabled="false"')
  })

  it('is read only for a caller who cannot manage the settings', async () => {
    const html = await renderCard({ settings, canEdit: false, reloadSettings: async () => settings })
    expect(html).toContain('data-testid="sales-opportunity-win" data-disabled="true"')
    expect(html).toContain('data-testid="sales-opportunity-amount" data-disabled="true"')
  })
})

describe('SalesOrderOpportunity', () => {
  it('names the opportunity, linking to its CRM page, with where it stands', async () => {
    const html = await render({ opportunity })
    expect(html).toContain('href="/crm/opportunities/5"')
    expect(html).toContain('فهد الحربي')
    expect(html).toContain('data-badge="مفتوحة"')
    expect(html).not.toContain('مؤرشفة')
  })

  it('shows a won opportunity as won and an archived one as archived', async () => {
    expect(await render({ opportunity: { ...opportunity, status: 'won' } })).toContain('data-badge="مربوحة"')
    const lost = await render({ opportunity: { ...opportunity, status: 'lost', active: false } })
    expect(lost).toContain('data-badge="خاسرة"')
    expect(lost).toContain('data-badge="مؤرشفة"')
  })
})

// Every value the server can send has a word in both languages, so a new one fails here and not as a raw key on a page.
const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree)
const missing = (tree: unknown, locale: string, paths: string[]) => paths.filter(path => typeof at(tree, path) !== 'string' || at(tree, path) === '').map(path => `${locale}: ${path}`)

describe('the opportunity strings', () => {
  it('has a label and a hint for every setting choice, in both languages', () => {
    const paths = [...SalesOpportunityWinSchema.options, ...SalesOpportunityWinAmountSchema.options].flatMap(value => [`settings.opportunity.${value}`, `settings.opportunity.${value}Hint`])
    expect([...missing(ar.sales, 'ar', paths), ...missing(en.sales, 'en', paths)]).toEqual([])
  })

  it('has a word for every opportunity status and every state of an order on the opportunity page', () => {
    const sales = ['pending', 'won', 'lost'].map(value => `record.opportunityStatus.${value}`)
    const crm = ['draft', 'sent', 'confirmed', 'cancelled'].map(value => `opportunities.orders.state.${value}`)
    expect([...missing(ar.sales, 'ar', sales), ...missing(en.sales, 'en', sales), ...missing(arCrm.crm, 'ar', crm), ...missing(enCrm.crm, 'en', crm)]).toEqual([])
  })

  it('uses no em dash', () => {
    for (const tree of [ar.sales.settings.opportunity, en.sales.settings.opportunity, arCrm.crm.opportunities.orders, enCrm.crm.opportunities.orders]) {
      expect(JSON.stringify(tree)).not.toContain('—')
    }
  })
})
