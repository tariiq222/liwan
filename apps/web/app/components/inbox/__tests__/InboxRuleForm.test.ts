import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { InboxRule } from '@webvue/contracts'
import * as helpers from '../../../composables/inbox/inboxAutomation'
import { PRIORITIES } from '../../../composables/inbox/inboxPresentation'

const filename = new URL('../InboxRuleForm.vue', import.meta.url).pathname
const STORED: InboxRule = {
  id: 4, sequence: 10, channel: null, flow: null, name: 'حجز', active: true, match_kind: 'contains', keywords: ['حجز'], option_id: null, hours: 'any', stop: true,
  reply: { body: 'تفضل' }, resolve: false, department: null, assignee: null, tags: [], priority: null,
}

// The component script is compiled and run against stubbed composables, as the other component tests do.
function mountForm(props: { rule?: InboxRule } = {}, saveImpl?: () => Promise<unknown>) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-rule-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const save = vi.fn(saveImpl ?? (async (_input: { id?: number; body: unknown }) => ({ ...STORED, id: 9 })))
  const toast = vi.fn()
  const emitted: Array<[string, unknown]> = []
  const list = (items: unknown[] = []) => ({ data: Vue.ref({ items, total: items.length }) })
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: toast }),
    ...helpers, PRIORITIES, InboxAutoContentEditor: {}, InboxFlowPicker: {},
    useSaveInboxRule: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    useInboxCatalogEnabled: () => Vue.ref(true),
    useInboxAutomationChannels: () => list(), useInboxDepartments: () => list(), useInboxTags: () => list(), useInboxAgents: () => list(),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup(Vue.reactive({ backTo: '/back', ...props }), { expose: () => {}, emit: (name: string, value: unknown) => { emitted.push([name, value]) } })))
  return { state, save, toast, emitted }
}

describe('InboxRuleForm', () => {
  it('sends nothing and shows what is missing until the rule is complete', async () => {
    const { state, save } = mountForm()
    expect(state.nameError).toBeUndefined()
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.nameError).toBe('inbox.settings.requiredName')
    expect(state.matchError).toBe('inbox.automation.rules.keywordsRequired')
  })

  it('creates a keyword rule with a text reply and emits it', async () => {
    const { state, save, emitted } = mountForm()
    state.draft.name = 'أسعار'
    state.draft.keywords = ['سعر']
    state.draft.reply.body = 'الأسعار في القائمة'
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: undefined, body: expect.objectContaining({ name: 'أسعار', match_kind: 'contains', keywords: ['سعر'], reply: { body: 'الأسعار في القائمة' }, channel_id: null }) })
    expect(emitted).toEqual([['saved', expect.objectContaining({ id: 9 })]])
  })

  it('needs an action: a rule with no reply and nothing else to do is not sent', async () => {
    const { state, save } = mountForm()
    state.draft.name = 'x'
    state.draft.keywords = ['x']
    state.draft.replyEnabled = false
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.actionError).toBe('inbox.automation.rules.actionRequired')
    state.draft.resolve = true
    await state.submit()
    expect(save).toHaveBeenCalledOnce()
  })

  it('edits a stored rule by id and is clean until something changes', async () => {
    const { state, save } = mountForm({ rule: STORED })
    expect(state.dirty).toBe(false)
    state.draft.matchKind = 'option'
    state.draft.optionId = 'btn_1'
    expect(state.dirty).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: 4, body: expect.objectContaining({ match_kind: 'option', option_id: 'btn_1', keywords: [] }) })
    expect(state.dirty).toBe(false)
  })

  it('shows the server\'s message on the field it names', async () => {
    const refusal = Object.assign(new Error('الكلمات مطلوبة'), { field: 'keywords' })
    const { state, toast } = mountForm({ rule: STORED }, async () => { throw refusal })
    state.draft.name = 'اسم جديد'
    await state.submit()
    expect(state.fieldError('keywords')).toBe('الكلمات مطلوبة')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  it('needs a channel and a form for a form rule, and sends the form id', async () => {
    const { state, save } = mountForm()
    state.draft.name = 'عند الطلب'
    state.draft.matchKind = 'flow'
    state.draft.resolve = true
    state.draft.replyEnabled = false
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.matchError).toBe('inbox.automation.rules.flowNeedsChannel')
    state.draft.channelId = 3
    expect(state.matchError).toBe('inbox.automation.rules.flowRequired')
    state.draft.flowId = 9
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: undefined, body: expect.objectContaining({ match_kind: 'flow', flow_id: 9, channel_id: 3, keywords: [], option_id: null }) })
  })
})
