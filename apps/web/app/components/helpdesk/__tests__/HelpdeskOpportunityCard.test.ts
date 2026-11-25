import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const filename = resolve(import.meta.dirname, '../HelpdeskOpportunityCard.vue')
const link = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label'], setup: props => () => Vue.h('span', { 'data-badge': props.label }) })
const section = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', [slots.actions?.(), slots.default?.()]) })
const button = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', { 'data-testid': attrs['data-testid'], disabled: attrs.disabled || undefined }, String(attrs.label)) })
const pickList = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'pick-list' }) })
const alert = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('div', { role: attrs.role, 'data-testid': attrs['data-testid'] }, String(attrs.description)) })

interface Setup { read?: boolean; write?: boolean; data: unknown; error?: unknown; picking?: boolean; hydrated?: boolean; pending?: boolean }
function render({ read = true, write = true, data, error = null, picking = false, hydrated = true, pending = false }: Setup) {
  const query = { data: Vue.ref(data), error: Vue.ref(error), isSuccess: Vue.ref(!error), isFetching: Vue.ref(false), refetch: vi.fn() }
  const mutation = { mutateAsync: vi.fn(), isPending: Vue.ref(pending) }
  // The first `ref` of the card is its `picking` flag: starting it open stands in for a click on the link button.
  let refs = 0
  const ref = ((value: unknown) => Vue.ref(refs++ === 0 && picking ? true : value)) as typeof Vue.ref
  return renderShared(filename, { ticketId: 4 }, {}, {
    hydrated,
    messages: { 'helpdesk.opportunity.none': 'غير مرتبطة', 'helpdesk.opportunity.hidden': 'مرتبطة بفرصة لا تراها', 'helpdesk.opportunity.link': 'ربط بفرصة', 'helpdesk.opportunity.change': 'تغيير', 'helpdesk.opportunity.unlink': 'فك الربط', 'helpdesk.opportunity.archived': 'مؤرشفة', 'helpdesk.opportunity.status.won': 'تم البيع' },
    globals: { useToast: () => ({ add: vi.fn() }), ref },
    modules: {
      '@/composables/useHelpdeskOpportunity': {
        helpdeskOpportunityErrorMessage: () => '',
        useHelpdeskOpportunityAccess: () => ({ read: Vue.ref(read), write: Vue.ref(write) }),
        useTicketOpportunity: () => query,
        useLinkTicketOpportunity: () => mutation,
        useUnlinkTicketOpportunity: () => mutation,
        useHelpdeskOpportunityPick: () => ({ ...query, data: Vue.ref({ items: [] }) }),
      },
    },
    stubs: { NuxtLink: link, SharedStatusBadge: badge, SharedRecordSection: section, UButton: button, SharedPickList: pickList, UAlert: alert },
  })
}

const ref = { id: 9, contact_name: 'منى العتيبي', stage: { id: 1, name: 'جديد' }, status: 'won', active: true }
const linked = { opportunity: ref, hidden: false }

describe('HelpdeskOpportunityCard', () => {
  it('shows the linked opportunity with stage and status, linking to its page, with change and unlink for writers', async () => {
    const html = await render({ data: linked })
    expect(html).toContain('href="/crm/opportunities/9"')
    expect(html).toContain('منى العتيبي')
    expect(html).toContain('جديد')
    expect(html).toContain('data-badge="تم البيع"')
    expect(html).toContain('>تغيير<')
    expect(html).toContain('data-testid="helpdesk-opportunity-unlink"')
    expect(html).not.toContain('helpdesk-opportunity-archived')
  })

  it('marks an archived opportunity', async () => {
    expect(await render({ data: { ...linked, opportunity: { ...ref, active: false } } })).toContain('data-badge="مؤرشفة"')
  })

  it('offers only the link action when nothing is linked', async () => {
    const html = await render({ data: { opportunity: null, hidden: false } })
    expect(html).toContain('غير مرتبطة')
    expect(html).toContain('>ربط بفرصة<')
    expect(html).not.toContain('helpdesk-opportunity-unlink')
  })

  it('says a hidden link exists without naming it, and still lets a writer change or unlink it', async () => {
    const html = await render({ data: { opportunity: null, hidden: true } })
    expect(html).toContain('مرتبطة بفرصة لا تراها')
    expect(html).not.toContain('/crm/opportunities/')
    expect(html).toContain('>تغيير<')
    expect(html).toContain('data-testid="helpdesk-opportunity-unlink"')
  })

  it('gives a read-only user no action', async () => {
    const html = await render({ write: false, data: linked })
    expect(html).toContain('منى العتيبي')
    expect(html).not.toContain('<button')
  })

  it('expands the picker inline while picking, replacing the action buttons', async () => {
    const html = await render({ data: linked, picking: true })
    expect(html).toContain('data-testid="helpdesk-opportunity-picker"')
    expect(html).toContain('data-testid="pick-list"')
    expect(html).toContain('data-testid="helpdesk-opportunity-confirm"')
    expect(html).not.toContain('helpdesk-opportunity-unlink')
  })

  it('never opens the picker for a read-only user', async () => {
    expect(await render({ write: false, data: linked, picking: true })).not.toContain('helpdesk-opportunity-picker')
  })

  it('locks the controls before hydration and while a write runs', async () => {
    expect(await render({ data: linked, hydrated: false })).toMatch(/data-testid="helpdesk-opportunity-link" disabled|disabled[^>]*data-testid="helpdesk-opportunity-link"/)
    expect(await render({ data: linked, pending: true })).toMatch(/disabled[^>]*data-testid="helpdesk-opportunity-unlink"|data-testid="helpdesk-opportunity-unlink" disabled/)
  })

  it('hides the card without the read rights, on a refused read, or without an answer', async () => {
    expect(await render({ read: false, data: linked })).not.toContain('<section')
    expect(await render({ data: undefined, error: { status: 403 } })).not.toContain('<section')
    expect(await render({ data: undefined, error: { status: 500 } })).not.toContain('<section')
  })
})
