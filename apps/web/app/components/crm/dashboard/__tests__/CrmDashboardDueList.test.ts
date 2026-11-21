import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as crmOpportunity from '../../../../utils/crmOpportunity'
import * as crmOrderGate from '../../../../utils/crmOrderGate'

const section = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', [slots.default?.(), slots.actions?.()]) })
const state = Vue.defineComponent({ props: ['loading', 'error'], setup: props => () => Vue.h('p', { 'data-testid': 'state' }, props.loading ? 'loading' : 'failed') })
const form = Vue.defineComponent({ props: ['outcomes', 'error'], setup: props => () => Vue.h('form', { 'data-testid': 'call-form', 'data-outcomes': (props.outcomes as { id: number }[]).map(outcome => outcome.id).join(), 'data-error': props.error }) })
const step = Vue.defineComponent({ props: ['candidates'], setup: props => () => Vue.h('div', { 'data-testid': 'conflict-step', 'data-candidates': (props.candidates as { id: number }[]).map(candidate => candidate.id).join() }) })
const stubs = { ...DEFAULT_STUBS, SharedRecordSection: section, SharedPageState: state, SharedEmptyState: Vue.defineComponent({ setup: () => () => Vue.h('p', 'empty') }) }
const item = { id: 1, contact_name: 'أحمد', phone: '0501234567', stage: { id: 1, name: 'جديد' }, next_call_at: '2026-10-28T09:00:00Z', win_by_order: false }
const outcomes = [{ id: 1, effect: 'follow_up' }, { id: 3, effect: 'won' }]
const render = (props: Record<string, unknown>, hydrated = true) => renderShared(resolve(import.meta.dirname, '../CrmDashboardDueList.vue'), { items: [item], total: 1, viewAllTo: '/all', now: Date.parse('2026-10-28T12:00:00Z'), canRecord: true, outcomes, ...props }, {}, {
  hydrated,
  stubs,
  modules: {
    '@/components/crm/opportunity/CrmOpportunityCallForm.vue': { __esModule: true, default: form },
    '@/components/customers/CustomerConflictStep.vue': { __esModule: true, default: step },
    '@/utils/crmOpportunity': crmOpportunity,
    '@/utils/crmOrderGate': crmOrderGate,
  },
})

describe('CrmDashboardDueList', () => {
  it('shows the stage beside the time and one record button per row, with no form until it is pressed', async () => {
    const html = await render({})
    expect(html).toContain('data-testid="crm-due-stage"')
    expect(html).toContain('crm-due-record')
    expect(html).not.toContain('call-form')
  })

  it('opens the form in the row, without the sold outcome while an order wins', async () => {
    expect(await render({ openId: 1 })).toContain('data-outcomes="1,3"')
    expect(await render({ openId: 1, items: [{ ...item, win_by_order: true }] })).toContain('data-outcomes="1"')
  })

  it('offers no record button to someone who may not work leads', async () => {
    expect(await render({ canRecord: false, openId: 1 })).not.toContain('crm-due-record')
  })

  it('disables every record button, the open row included, while the open form holds text', async () => {
    const html = await render({ items: [item, { ...item, id: 2 }], openId: 1, dirty: true })
    expect(html.match(/disabled/g)).toHaveLength(2)
    expect(await render({ openId: 1, dirty: false })).not.toContain('disabled')
  })

  it('keeps the record button disabled until the page is hydrated', async () => {
    expect(await render({}, false)).toContain('disabled')
    expect(await render({})).not.toContain('disabled')
  })

  it('links a refusal to the record', async () => {
    const html = await render({ openId: 1, failure: 'closed' })
    expect(html).toContain('data-error="closed"')
    expect(html).toContain('crm-due-open-record')
  })

  it('asks which customer to link under the open row when the server stopped a sold call', async () => {
    const candidates = [{ id: 7, name: 'منى', phone_last4: '4567' }]
    const html = await render({ openId: 1, candidates })
    expect(html).toContain('data-candidates="7"')
    expect(await render({ openId: 1 })).not.toContain('conflict-step')
    expect(await render({ openId: 2, candidates })).not.toContain('conflict-step')
  })

  it('shows the error state instead of an empty list when the query failed', async () => {
    expect(await render({ items: [], total: 0, error: new Error('x') })).toContain('failed')
  })
})
