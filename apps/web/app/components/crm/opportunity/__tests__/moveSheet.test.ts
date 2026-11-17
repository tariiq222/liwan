import { resolve } from 'node:path'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { expect, it } from 'vitest'
import { loadShared, DEFAULT_STUBS } from '../../../../../../../packages/ui/test/helpers/renderShared'
import * as boardMove from '../../../../utils/crmBoardMove'
import * as opportunity from '../../../../utils/crmOpportunity'

const Slideover = Vue.defineComponent({
  inheritAttrs: false,
  props: { open: Boolean, title: String },
  setup: (props, { slots }) => () => (props.open ? Vue.h('div', { 'data-side': 'bottom' }, [Vue.h('h2', props.title), slots.body?.(), slots.footer?.()]) : null),
})
const Sale = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'sale-fields' }) })
const Field = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'], 'data-name': attrs.name }, slots.default?.()) })

const stages = [
  { id: 1, name: 'New', active: true, sequence: 1, is_won: false },
  { id: 2, name: 'Contacted', active: true, sequence: 2, is_won: false },
  { id: 4, name: 'Sold', active: true, sequence: 4, is_won: true },
]
const item = { id: 7, contact_name: 'Ahmad', stage: { id: 1, name: 'New' }, win_by_order: false }

async function sheetHtml(to: unknown, conflict = false) {
  const Sheet = loadShared(resolve(import.meta.dirname, '../CrmOpportunityMoveSheet.vue'), {
    modules: {
      './CrmOpportunitySaleForm.vue': { __esModule: true, default: Sale },
      '@/utils/crmBoardMove': boardMove,
      '@/utils/crmOpportunity': opportunity,
    },
  })
  const move = to === null ? null : { item, to, revert: () => undefined }
  const app = Vue.createSSRApp({ render: () => Vue.h(Sheet, { move, stages, packages: [], lostReasons: [{ id: 1, name: 'No budget', active: true, protected: false }], error: 'refused', conflict }) })
  for (const [name, component] of Object.entries(DEFAULT_STUBS)) app.component(name, component)
  app.component('USlideover', Slideover)
  app.component('UFormField', Field)
  app.component('USelect', Field)
  return renderToString(app)
}

it('is closed without a move', async () => {
  expect(await sheetHtml(null)).toBe('<!---->')
})

it('asks only for the sale fields on the sold stage, titled with the card and the stage', async () => {
  const html = await sheetHtml(stages[2])
  expect(html).toContain('crm.opportunities.move.title')
  expect(html).toContain('sale-fields')
  expect(html).not.toContain('move-lost-reason')
  expect(html).not.toContain('crm-move-stage')
  expect(html).toContain('crm.opportunities.sale.submit')
  expect(html).toContain('refused')
})

it('asks only for the loss reason in the lost zone', async () => {
  const html = await sheetHtml('lost')
  expect(html).toContain('crm.opportunities.move.titleLost')
  expect(html).not.toContain('sale-fields')
  expect(html).toContain('crm.opportunities.lost.confirm')
})

it('puts the stage picker first when opened by the move action, with nothing else until a choice', async () => {
  const html = await sheetHtml('pick')
  expect(html).toContain('crm.opportunities.move.titlePick')
  expect(html).toContain('data-testid="crm-move-stage"')
  expect(html).not.toContain('sale-fields')
  expect(html).toMatch(/disabled[^>]*data-testid="crm-move-confirm"/)
})

it('points to the record when the sale stopped at a customer conflict, and not otherwise', async () => {
  const html = await sheetHtml(stages[2], true)
  expect(html).toContain('data-testid="crm-move-open-record"')
  expect(html).toContain('crm.dashboard.agent.openRecord')
  expect(await sheetHtml(stages[2])).not.toContain('crm-move-open-record')
})
