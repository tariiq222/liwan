import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const filename = resolve(import.meta.dirname, '../InboxOpportunityCard.vue')
const link = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label'], setup: props => () => Vue.h('span', { 'data-badge': props.label }) })
const section = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', [slots.actions?.(), slots.default?.()]) })
const button = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h(attrs.to ? 'a' : 'button', { 'data-testid': attrs['data-testid'], href: attrs.to, disabled: attrs.disabled || undefined }, String(attrs.label)) })
const pickList = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'pick-list' }) })

interface Setup { read?: boolean; write?: boolean; create?: boolean; manualOnly?: boolean; data: unknown; error?: unknown; picking?: boolean }
function render({ read = true, write = true, create = true, manualOnly = !create, data, error = null }: Setup, props: Record<string, unknown> = {}) {
  const query = { data: Vue.ref(data), error: Vue.ref(error), isSuccess: Vue.ref(!error), isFetching: Vue.ref(false), refetch: vi.fn() }
  const mutation = { mutateAsync: vi.fn(), isPending: Vue.ref(false) }
  return renderShared(filename, { conversationId: 3, contactPhone: '+966500000001', canReply: true, ...props }, {}, {
    hydrated: true,
    messages: { 'inbox.opportunity.none': 'غير مرتبطة', 'inbox.opportunity.link': 'ربط فرصة', 'inbox.opportunity.unlink': 'فصل', 'inbox.opportunity.archived': 'مؤرشفة', 'inbox.opportunity.status.pending': 'قيد المتابعة', 'inbox.opportunity.createManualOnly': 'الإسناد فقط', 'inbox.opportunity.hidden': 'مرتبطة بفرصة لا يمكنك عرضها' },
    globals: { useToast: () => ({ add: vi.fn() }) },
    modules: {
      '@/composables/inbox/inboxOpportunityErrors': { inboxOpportunityErrorMessage: () => '' },
      '@/composables/useInboxOpportunity': {
        useInboxOpportunityAccess: () => ({ read: Vue.ref(read), write: Vue.ref(write), create: Vue.ref(create), createManualOnly: Vue.ref(manualOnly), createPending: Vue.ref(false) }),
        useConversationOpportunity: () => query,
        useCreateConversationOpportunity: () => mutation,
        useLinkConversationOpportunity: () => mutation,
        useUnlinkConversationOpportunity: () => mutation,
        useOpportunityPick: () => ({ ...query, data: Vue.ref({ items: [] }) }),
      },
    },
    stubs: { NuxtLink: link, SharedStatusBadge: badge, SharedRecordSection: section, UButton: button, SharedPickList: pickList },
  })
}

const none = { opportunity: null, hidden: false }
const linked = { id: 9, contact_name: 'منى العتيبي', stage: { id: 1, name: 'جديد' }, status: 'pending', active: true }

describe('InboxOpportunityCard', () => {
  it('shows the linked opportunity with its stage and status, linking to its page, and an unlink action', async () => {
    const html = await render({ data: { opportunity: linked, hidden: false } })
    expect(html).toMatch(/<a data-testid="inbox-opportunity-open" href="\/crm\/opportunities\/9"/)
    expect(html).toContain('منى العتيبي')
    expect(html).toContain('جديد')
    expect(html).toContain('data-badge="قيد المتابعة"')
    expect(html).toContain('data-testid="inbox-opportunity-unlink"')
    expect(html).not.toContain('inbox-opportunity-archived')
  })

  it('marks an archived opportunity', async () => {
    expect(await render({ data: { opportunity: { ...linked, active: false }, hidden: false } })).toContain('data-badge="مؤرشفة"')
  })

  it('offers the link action when none is linked, to a user who may write', async () => {
    const html = await render({ data: none })
    expect(html).toContain('غير مرتبطة')
    expect(html).toContain('data-testid="inbox-opportunity-link"')
  })

  it('offers creation from a contact with a phone and protects read-only conversations', async () => {
    expect(await render({ data: none })).toContain('data-testid="inbox-opportunity-create"')
    expect(await render({ data: none }, { contactPhone: null })).not.toContain('data-testid="inbox-opportunity-create"')
    expect(await render({ data: none }, { canReply: false })).not.toContain('data-testid="inbox-opportunity-create"')
    expect(await render({ data: { opportunity: linked, hidden: false } })).not.toContain('data-testid="inbox-opportunity-create"')
  })

  it('disables creation without claiming manual mode when the user cannot work or the access request failed', async () => {
    const html = await render({ data: none, create: false, manualOnly: false })
    expect(html).toMatch(/<button data-testid="inbox-opportunity-create" disabled/)
    expect(html).not.toContain('inbox-opportunity-create-reason')
  })

  it('disables creation with the manual reason when the server refused a user who can work, and keeps linking', async () => {
    const html = await render({ data: none, create: false })
    expect(html).toMatch(/<button data-testid="inbox-opportunity-create" disabled/)
    expect(html).toContain('data-testid="inbox-opportunity-create-reason"')
    expect(html).toContain('data-testid="inbox-opportunity-link"')
    expect(await render({ data: none })).not.toContain('inbox-opportunity-create-reason')
  })

  it('offers neither link nor unlink without the write capabilities or the reply right', async () => {
    expect(await render({ data: none, write: false })).not.toContain('inbox-opportunity-link')
    expect(await render({ data: { opportunity: linked, hidden: false }, write: false })).not.toContain('inbox-opportunity-unlink')
    expect(await render({ data: none }, { canReply: false })).not.toContain('inbox-opportunity-link')
  })

  it('says a link exists that the caller cannot view, with no create, link or unlink action', async () => {
    const html = await render({ data: { opportunity: null, hidden: true } })
    expect(html).toContain('data-testid="inbox-opportunity-hidden"')
    expect(html).toContain('مرتبطة بفرصة لا يمكنك عرضها')
    for (const id of ['none', 'create', 'link', 'unlink', 'linked']) expect(html).not.toContain(`inbox-opportunity-${id}`)
  })

  it('lets an assigner who cannot work create an opportunity when the server allows it, and nothing else', async () => {
    const html = await render({ data: none, write: false, create: true })
    expect(html).toMatch(/<button data-testid="inbox-opportunity-create"(?! disabled)/)
    expect(html).not.toContain('inbox-opportunity-link')
    expect(await render({ data: none, write: false, create: false })).not.toContain('inbox-opportunity-create')
  })

  it('is hidden without the read capabilities and when the read was refused', async () => {
    expect(await render({ read: false, data: none })).not.toContain('inbox-opportunity')
    expect(await render({ data: undefined, error: { status: 403 } })).not.toContain('inbox-opportunity')
  })
})
