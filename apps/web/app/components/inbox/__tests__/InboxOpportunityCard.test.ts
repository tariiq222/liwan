import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const filename = resolve(import.meta.dirname, '../InboxOpportunityCard.vue')
const link = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label'], setup: props => () => Vue.h('span', { 'data-badge': props.label }) })
const section = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', slots.default?.()) })
const button = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', { 'data-testid': attrs['data-testid'] }, String(attrs.label)) })
const pickList = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'pick-list' }) })

interface Setup { read?: boolean; write?: boolean; data: unknown; error?: unknown; picking?: boolean }
function render({ read = true, write = true, data, error = null }: Setup, props: Record<string, unknown> = {}) {
  const query = { data: Vue.ref(data), error: Vue.ref(error), isSuccess: Vue.ref(!error), isFetching: Vue.ref(false), refetch: vi.fn() }
  const mutation = { mutateAsync: vi.fn(), isPending: Vue.ref(false) }
  return renderShared(filename, { conversationId: 3, contactPhone: '+966500000001', canReply: true, ...props }, {}, {
    hydrated: true,
    messages: { 'inbox.opportunity.none': 'غير مرتبطة', 'inbox.opportunity.link': 'ربط فرصة', 'inbox.opportunity.unlink': 'فصل', 'inbox.opportunity.archived': 'مؤرشفة', 'inbox.opportunity.status.pending': 'قيد المتابعة' },
    globals: { useToast: () => ({ add: vi.fn() }) },
    modules: {
      '@/composables/inbox/inboxOpportunityErrors': { inboxOpportunityErrorMessage: () => '' },
      '@/composables/inbox/useInboxOpportunity': {
        useInboxOpportunityAccess: () => ({ read: Vue.ref(read), write: Vue.ref(write) }),
        useConversationOpportunity: () => query,
        useLinkConversationOpportunity: () => mutation,
        useUnlinkConversationOpportunity: () => mutation,
        useOpportunityPick: () => ({ ...query, data: Vue.ref({ items: [] }) }),
      },
    },
    stubs: { NuxtLink: link, SharedStatusBadge: badge, SharedRecordSection: section, UButton: button, SharedPickList: pickList },
  })
}

const linked = { id: 9, contact_name: 'منى العتيبي', stage: { id: 1, name: 'جديد' }, status: 'pending', active: true }

describe('InboxOpportunityCard', () => {
  it('shows the linked opportunity with its stage and status, linking to its page, and an unlink action', async () => {
    const html = await render({ data: linked })
    expect(html).toContain('href="/crm/opportunities/9"')
    expect(html).toContain('منى العتيبي')
    expect(html).toContain('جديد')
    expect(html).toContain('data-badge="قيد المتابعة"')
    expect(html).toContain('data-testid="inbox-opportunity-unlink"')
    expect(html).not.toContain('inbox-opportunity-archived')
  })

  it('marks an archived opportunity', async () => {
    expect(await render({ data: { ...linked, active: false } })).toContain('data-badge="مؤرشفة"')
  })

  it('offers the link action when none is linked, to a user who may write', async () => {
    const html = await render({ data: null })
    expect(html).toContain('غير مرتبطة')
    expect(html).toContain('data-testid="inbox-opportunity-link"')
  })

  it('offers neither link nor unlink without the write capabilities or the reply right', async () => {
    expect(await render({ data: null, write: false })).not.toContain('inbox-opportunity-link')
    expect(await render({ data: linked, write: false })).not.toContain('inbox-opportunity-unlink')
    expect(await render({ data: null }, { canReply: false })).not.toContain('inbox-opportunity-link')
  })

  it('is hidden without the read capabilities and when the read was refused', async () => {
    expect(await render({ read: false, data: null })).not.toContain('inbox-opportunity')
    expect(await render({ data: undefined, error: { status: 403 } })).not.toContain('inbox-opportunity')
  })
})
