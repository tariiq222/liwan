import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { InboxChannelAutomation, InboxRule } from '@webvue/contracts'
import * as helpers from '../../../composables/inbox/inboxAutomation'

// The scripts of the automation components, compiled and run against stubbed composables (as the other component tests do).
function run(file: string, bindings: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const filename = new URL(`../${file}`, import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: file }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const base = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), ...bindings,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  return Vue.proxyRefs(Vue.effectScope().run(() => component.setup(Vue.reactive(props), { expose: () => {}, emit: () => {} })))
}

const rule = (id: number, extra: Partial<InboxRule> = {}): InboxRule => ({
  id, sequence: id * 10, channel: null, flow: null, name: `rule ${id}`, active: true, match_kind: 'any', keywords: [], option_id: null, hours: 'any', stop: true,
  reply: { body: 'x' }, resolve: false, department: null, assignee: null, tags: [], priority: null, ...extra,
})

describe('InboxRulesSection', () => {
  function mount(items: InboxRule[]) {
    const reorder = vi.fn(); const patch = vi.fn(); const remove = vi.fn(); const toast = vi.fn()
    const state = run('InboxRulesSection.vue', {
      ...helpers, useToast: () => ({ add: toast }),
      useInboxRules: () => ({ data: Vue.ref({ items, total: items.length }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useReorderInboxRules: () => ({ mutate: reorder, isPending: Vue.ref(false) }),
      useSaveInboxRule: () => ({ mutate: patch, isPending: Vue.ref(false) }),
      useDeleteInboxRule: () => ({ mutate: remove, isPending: Vue.ref(false) }),
    })
    return { state, reorder, patch, remove }
  }

  it('posts the whole new order when a rule moves, and does not move past an end', () => {
    const items = [rule(1), rule(2), rule(3)]
    const { state, reorder } = mount(items)
    state.move(items[2], -1)
    expect(reorder).toHaveBeenCalledWith([1, 3, 2], expect.anything())
    state.move(items[0], -1)
    expect(reorder).toHaveBeenLastCalledWith([1, 2, 3], expect.anything())
  })

  it('switches a rule off with a partial patch', () => {
    const { state, patch } = mount([rule(1)])
    state.toggle(rule(1), false)
    expect(patch).toHaveBeenCalledWith({ id: 1, body: { active: false } }, expect.anything())
  })

  it('deletes only after the inline confirmation', () => {
    const { state, remove } = mount([rule(1)])
    state.confirmDelete()
    expect(remove).not.toHaveBeenCalled()
    state.deleting = rule(1)
    state.confirmDelete()
    expect(remove).toHaveBeenCalledWith(1, expect.anything())
  })

  it('summarises the match, the channel and the hours condition', () => {
    const { state } = mount([])
    expect(state.summary(rule(1, { match_kind: 'contains', keywords: ['حجز', 'موعد'], channel: { id: 1, name: 'واتساب' }, hours: 'outside' })))
      .toBe('inbox.automation.rules.match.contains: حجز، موعد · واتساب · inbox.automation.rules.hours.outside')
  })
})

describe('InboxChannelAutomationForm', () => {
  const stored: InboxChannelAutomation = {
    welcome: { enabled: false, idle_days: 0, content: null },
    away: { enabled: false, repeat_hours: 12, content: null },
    csat: { enabled: false, question: 'كيف تقيّم خدمتنا؟', good: 'راضٍ', neutral: 'محايد', bad: 'غير راضٍ' },
  }
  function mount() {
    const save = vi.fn(); const toast = vi.fn()
    const state = run('InboxChannelAutomationForm.vue', {
      ...helpers, InboxAutoContentEditor: {}, useToast: () => ({ add: toast }),
      useSaveInboxChannelAutomation: () => ({ mutate: save, isPending: Vue.ref(false) }),
    }, { channelId: 1, automation: stored })
    return { state, save }
  }

  it('is clean until something changes, and saves the changed block', () => {
    const { state, save } = mount()
    state.submit()
    expect(save).not.toHaveBeenCalled()
    state.draft.csat.enabled = true
    expect(state.dirty).toBe(true)
    state.submit()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ csat: { ...stored.csat, enabled: true } }), expect.anything())
  })

  it('does not save an enabled welcome without content, and says so', () => {
    const { state, save } = mount()
    state.draft.welcome.enabled = true
    state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.missing('welcome')).toBe(true)
    state.draft.welcome.content.body = 'أهلًا'
    state.submit()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ welcome: { enabled: true, idle_days: 0, content: { body: 'أهلًا' } } }), expect.anything())
  })
})
