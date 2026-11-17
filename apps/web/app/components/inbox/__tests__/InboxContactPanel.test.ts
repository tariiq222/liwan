import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

const filename = new URL('../InboxContactPanel.vue', import.meta.url).pathname
const messages: Record<string, string> = { 'inbox.erasedContact': 'Erased customer {id}', 'inbox.panel.contactErased': 'ERASED-HINT' }

function conversation(contact: Record<string, unknown>, canReply = true) {
  return {
    id: 3, revision: 1, can_reply: canReply, can_assign: true, assignee: null, department: null, tags: [], state: 'open', priority: 'normal',
    channel: { id: 1, name: 'WhatsApp' }, contact: { id: 9, phone: '966500000000', email: 'a@b.sa', ...contact },
  }
}

// The component is compiled and run against stubbed composables and form controls, as the other component tests do.
async function mountPanel(contact: Record<string, unknown>, detail: Record<string, unknown> | null = null, canReply = true) {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'inbox-contact-panel' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const patchContact = vi.fn()
  const query = { data: Vue.ref(undefined) }
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string, values?: { id?: number }) => (messages[key] ?? key).replace('{id}', String(values?.id)) }),
    useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }), useMe: () => ({ me: Vue.ref({ id: 1 }) }),
    useInboxCampaignsEnabled: () => Vue.ref(false), usePatchInboxContact: () => ({ mutate: patchContact, isPending: Vue.ref(false) }),
    useInboxConversationSave: () => ({ save: vi.fn(), patching: Vue.ref(false) }), useInboxAgents: () => query, useInboxDepartments: () => query, useInboxTags: () => query,
    inboxContactName: (c: { id: number; name: string; erased: boolean }, t: (key: string, values?: object) => string) => c.erased ? t('inbox.erasedContact', { id: c.id }) : c.name,
    useAccess: () => ({ can: () => true }), useInboxContact: () => ({ data: Vue.ref(detail) }),
    useLinkInboxContactCustomer: () => ({ mutateAsync: vi.fn(), isPending: Vue.ref(false) }),
    useCustomerConflict: () => ({ candidates: Vue.ref(null), offer: () => false, choose: vi.fn(), clear: vi.fn() }), isCustomerAlreadyLinked: () => false, CustomerLinkBlock: null, InboxOpportunityCard: null,
    CONVERSATION_STATES: [], PRIORITIES: [], InboxFlowSubmissionsSection: null, InboxContactMarketing: null,
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const state = component.setup({ conversation: conversation(contact, canReply) }, { expose: () => {} })
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'inbox-contact-panel', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  if (template.errors.length) throw template.errors[0]
  const render = new Function('Vue', transpile(template.code))(Vue)
  const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...state, props: { conversation: conversation(contact, canReply) } }), render }))
  const pass = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', { 'data-title': attrs.title as string | undefined }, [slots.default?.()]) })
  const linkBlock = Vue.defineComponent({ props: ['customer', 'canLink', 'canOpen'], setup: props => () => Vue.h('div', { 'data-testid': 'link-block', 'data-customer': (props.customer as { name: string } | null)?.name ?? 'none', 'data-can-link': String(props.canLink) }) })
  app.component('CustomerLinkBlock', linkBlock)
  for (const name of ['SharedRecordSection', 'InboxOpportunityCard', 'SharedPropertyRow', 'UFormField', 'InboxFlowSubmissionsSection', 'InboxContactMarketing', 'SharedPersonPicker', 'USelect', 'USelectMenu']) app.component(name, pass)
  app.component('UInput', Vue.defineComponent({ inheritAttrs: false, props: ['modelValue'], setup: (props, { attrs }) => () => Vue.h('input', { value: props.modelValue, disabled: attrs.disabled === true || undefined, 'data-type': attrs.type ?? 'text' }) }))
  app.component('UButton', Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', { type: attrs.type as string }, String(attrs.label)) }))
  return { html: await renderToString(app), state: Vue.proxyRefs(state), patchContact }
}

describe('InboxContactPanel contact fields', () => {
  it('lets a normal contact be edited and saved', async () => {
    const { html } = await mountPanel({ name: 'Sara', erased: false })
    expect(html).toContain('value="Sara"')
    expect(html).not.toContain('disabled')
    expect(html).toContain('inbox.panel.saveContact')
    expect(html).not.toContain('ERASED-HINT')
  })

  it('shows an erased contact by its translated name, locked, with a hint and no save button', async () => {
    const { html, state, patchContact } = await mountPanel({ name: 'Erased contact 9', email: null, erased: true })
    expect(html).toContain('value="Erased customer 9"')
    expect(html).not.toContain('Erased contact 9')
    expect(html.match(/<input[^>]*disabled/g)).toHaveLength(2)
    expect(html).not.toContain('inbox.panel.saveContact')
    expect(html).toContain('ERASED-HINT')
    state.name = 'Renamed'
    state.saveContact()
    expect(patchContact).not.toHaveBeenCalled()
  })
})

describe('InboxContactPanel sections', () => {
  it('puts the conversation controls first, then the contact details', async () => {
    const { html } = await mountPanel({ name: 'Sara', erased: false })
    expect(html.indexOf('data-title="inbox.panel.conversation"')).toBeGreaterThan(-1)
    expect(html.indexOf('data-title="inbox.panel.conversation"')).toBeLessThan(html.indexOf('data-title="inbox.panel.contact"'))
  })
})

describe('InboxContactPanel customer link', () => {
  it('waits for the contact detail before showing the customer section', async () => {
    const { html } = await mountPanel({ name: 'Sara', erased: false })
    expect(html).not.toContain('link-block')
  })

  it('shows the linked customer and lets a replier link an unlinked contact', async () => {
    const linked = await mountPanel({ name: 'Sara', erased: false }, { id: 9, customer: { id: 4, name: 'Sara Co' } })
    expect(linked.html).toContain('data-customer="Sara Co"')
    const unlinked = await mountPanel({ name: 'Sara', erased: false }, { id: 9, customer: null })
    expect(unlinked.html).toContain('data-customer="none"')
    expect(unlinked.html).toContain('data-can-link="true"')
  })

  it('leaves the section out for an erased contact without a customer', async () => {
    const { html } = await mountPanel({ name: 'x', erased: true }, { id: 9, customer: null })
    expect(html).not.toContain('link-block')
  })

  it('leaves the section out when the server hides the customer from a viewer who cannot link, and shows a visible one read-only', async () => {
    const hidden = await mountPanel({ name: 'Sara', erased: false }, { id: 9, customer: null }, false)
    expect(hidden.html).not.toContain('link-block')
    const visible = await mountPanel({ name: 'Sara', erased: false }, { id: 9, customer: { id: 4, name: 'Sara Co' } }, false)
    expect(visible.html).toContain('data-customer="Sara Co"')
    expect(visible.html).toContain('data-can-link="false"')
  })
})
