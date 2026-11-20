import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import { mountScript } from './scriptHarness'

const filename = resolve(import.meta.dirname, '../InboxTicketsCard.vue')
const link = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label'], setup: props => () => Vue.h('span', { 'data-badge': props.label }) })
const section = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', { 'data-testid': 'inbox-tickets' }, slots.default?.()) })
const button = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', { 'data-testid': attrs['data-testid'], disabled: attrs.disabled || undefined }, String(attrs.label)) })
const alert = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('div', { role: attrs.role, 'data-testid': attrs['data-testid'] }, String(attrs.description)) })
const field = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })

interface Setup { read?: boolean; create?: boolean; data?: unknown; error?: unknown }
const open = { id: 21, number: 'HD-0021', subject: 'تأخر التوصيل', stage: { id: 1, name: 'جديدة', closed: false }, created_at: null }
const closed = { id: 18, number: 'HD-0018', subject: 'استفسار', stage: { id: 4, name: 'مغلقة', closed: true }, created_at: null }

function render({ read = true, create = true, data = { items: [], total: 0 }, error = null }: Setup) {
  const query = { data: Vue.ref(data), error: Vue.ref(error), isSuccess: Vue.ref(!error) }
  const mutation = { mutateAsync: vi.fn(), isPending: Vue.ref(false) }
  return renderShared(filename, { conversationId: 3 }, {}, {
    hydrated: true,
    messages: { 'inbox.tickets.none': 'لا تذاكر', 'inbox.tickets.raise': 'رفع تذكرة', 'inbox.tickets.openExists': 'لهذه المحادثة تذكرة مفتوحة' },
    globals: { useToast: () => ({ add: vi.fn() }) },
    modules: {
      '@/composables/useInboxTickets': {
        useInboxTicketsAccess: () => ({ read: Vue.ref(read), create: Vue.ref(create) }),
        useConversationTickets: () => query,
        useCreateConversationTicket: () => mutation,
      },
    },
    stubs: { NuxtLink: link, SharedStatusBadge: badge, SharedRecordSection: section, UButton: button, UAlert: alert, UFormField: field, UInput: field },
  })
}

describe('InboxTicketsCard', () => {
  it('lists each ticket with its number, subject, stage and a link to its page', async () => {
    const html = await render({ data: { items: [open, closed], total: 2 } })
    expect(html).toContain('href="/helpdesk/21"')
    expect(html).toContain('HD-0021')
    expect(html).toContain('تأخر التوصيل')
    expect(html).toContain('data-badge="جديدة"')
    expect(html).toContain('data-badge="مغلقة"')
  })

  it('shows the empty text and the raise action when there is no ticket', async () => {
    const html = await render({})
    expect(html).toContain('data-testid="inbox-tickets-none"')
    expect(html).toContain('data-testid="inbox-tickets-raise"')
  })

  it('offers the raise action when every ticket is closed and not while one is open', async () => {
    expect(await render({ data: { items: [closed], total: 1 } })).toContain('inbox-tickets-raise')
    expect(await render({ data: { items: [open, closed], total: 2 } })).not.toContain('inbox-tickets-raise')
  })

  it('does not offer the raise action to a user who cannot create', async () => {
    expect(await render({ create: false })).not.toContain('inbox-tickets-raise')
  })

  it('is hidden without the read capabilities and when the read was refused', async () => {
    expect(await render({ read: false })).not.toContain('inbox-tickets')
    expect(await render({ data: undefined, error: { status: 403 } })).not.toContain('inbox-tickets')
  })
})

function mountRaise(mutateAsync: (body: unknown) => Promise<unknown>) {
  const toast = { add: vi.fn() }
  const { state } = mountScript(new URL('../InboxTicketsCard.vue', import.meta.url), {
    useToast: () => toast,
    useInboxTicketsAccess: () => ({ read: Vue.ref(true), create: Vue.ref(true) }),
    useConversationTickets: () => ({ data: Vue.ref({ items: [], total: 0 }), error: Vue.ref(null), isSuccess: Vue.ref(true) }),
    useCreateConversationTicket: () => ({ mutateAsync, isPending: Vue.ref(false) }),
  }, { conversationId: 3 })
  return { state, toast }
}

describe('InboxTicketsCard raise form', () => {
  it('sends only the trimmed subject, then closes the form with a toast', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    const { state, toast } = mountRaise(mutateAsync)
    state.raising = true
    state.subject = '  تأخر التوصيل  '
    await state.raise()
    expect(mutateAsync).toHaveBeenCalledWith({ subject: 'تأخر التوصيل' })
    expect(state.raising).toBe(false)
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
  })

  it('does not send an empty subject', async () => {
    const mutateAsync = vi.fn()
    const { state } = mountRaise(mutateAsync)
    state.subject = '   '
    await state.raise()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('names the open ticket on a 409 open_ticket_exists and closes the form', async () => {
    const { state } = mountRaise(vi.fn().mockRejectedValue({ status: 409, code: 'conflict', details: { reason: 'open_ticket_exists' } }))
    state.raising = true
    state.subject = 'x'
    await state.raise()
    expect(state.failure).toBe('inbox.tickets.openExists')
    expect(state.raising).toBe(false)
  })

  it('keeps the form and shows a generic or forbidden message for other failures', async () => {
    const generic = mountRaise(vi.fn().mockRejectedValue({ status: 500 }))
    generic.state.raising = true
    generic.state.subject = 'x'
    await generic.state.raise()
    expect(generic.state.failure).toBe('errors.generic')
    expect(generic.state.raising).toBe(true)
    const forbidden = mountRaise(vi.fn().mockRejectedValue({ status: 403 }))
    forbidden.state.subject = 'x'
    await forbidden.state.raise()
    expect(forbidden.state.failure).toBe('errors.forbidden')
  })
})
