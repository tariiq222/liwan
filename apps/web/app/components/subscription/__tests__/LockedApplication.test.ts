import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as Vue from 'vue'

const component = resolve(__dirname, '../LockedApplication.vue')
const messages: Record<string, string> = {
  'subscription.locked.title.notInPlan': 'T-notInPlan {app}', 'subscription.locked.title.readOnly': 'T-readOnly {app}', 'subscription.locked.title.notEnabled': 'T-notEnabled {app}',
  'subscription.locked.cause.notInPlan': 'C-notInPlan', 'subscription.locked.cause.paymentSuspended': 'C-paymentSuspended', 'subscription.locked.cause.readOnly': 'C-readOnly', 'subscription.locked.cause.notEnabled': 'C-notEnabled',
  'subscription.locked.readable': 'R-readable', 'subscription.locked.askAdmin': 'A-admin', 'subscription.locked.askSubscriptionManager': 'A-subscription',
  'subscription.locked.thisApplication': 'this application',
  'subscription.locked.actions.seePlans': 'seePlans', 'subscription.locked.actions.pay': 'pay', 'subscription.locked.actions.openData': 'openData',
  'subscription.locked.actions.seePlansLabel': 'L-plans {app}', 'subscription.locked.actions.payLabel': 'L-pay {app}', 'subscription.locked.actions.openDataLabel': 'L-data {app}',
}
const base = { application: 'CRM', cause: 'not_in_plan', audience: 'manager', dataPath: null }
const render = (props: Record<string, unknown>) => renderShared(component, { ...base, ...props }, {}, { messages, globals: { useTemplateRef: Vue.useTemplateRef, onMounted: Vue.onMounted } })

describe('LockedApplication', () => {
  it('gives a manager one plans action when the application is not in the plan', async () => {
    const html = await render({})
    expect(html).toContain('T-notInPlan CRM')
    expect(html).toContain('href="/subscription/change"')
    expect(html).toContain('aria-label="L-plans CRM"')
    expect(html).not.toContain('openData')
    expect(html).not.toContain('R-readable')
  })

  it('sends a manager to payment when the cause is an unpaid invoice', async () => {
    const html = await render({ cause: 'payment_suspended' })
    expect(html).toContain('href="/subscription"')
    expect(html).toContain('C-paymentSuspended')
    expect(html).not.toContain('/subscription/change')
  })

  it('tells a member to ask, with no billing link', async () => {
    const html = await render({ audience: 'member' })
    expect(html).toContain('A-admin')
    expect(html).not.toContain('/subscription')
    const suspended = await render({ audience: 'member', cause: 'payment_suspended' })
    expect(suspended).toContain('A-subscription')
    expect(suspended).not.toContain('href="/subscription')
  })

  it('offers existing data, read-only, only when a data path exists', async () => {
    const html = await render({ cause: 'read_only', dataPath: '/crm' })
    expect(html).toContain('R-readable')
    expect(html).toContain('href="/crm"')
    expect(html).toContain('aria-label="L-data CRM"')
    const member = await render({ audience: 'member', dataPath: '/crm' })
    expect(member).toContain('href="/crm"')
    expect(member).not.toContain('href="/subscription')
  })

  it('shows no plan or payment action in non_saas', async () => {
    const html = await render({ cause: 'not_enabled', audience: 'non_saas' })
    expect(html).toContain('T-notEnabled CRM')
    expect(html).toContain('A-admin')
    expect(html).not.toContain('/subscription')
    expect(html).not.toContain('seePlans')
  })

  it('falls back to a generic name and drops the heading on the standalone card', async () => {
    const html = await render({ application: null, heading: false })
    expect(html).toContain('C-notInPlan')
    expect(html).not.toContain('<h1')
    expect(await render({ application: null })).toContain('T-notInPlan this application')
  })

  it('focuses the heading on render', () => {
    const source = readFileSync(component, 'utf8')
    expect(source).toContain('headingEl.value?.focus()')
    expect(source).toContain('tabindex="-1"')
  })
})
