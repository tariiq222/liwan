import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInboxDrafts } from '../../../composables/inbox/inboxDrafts'
import { cannedSuggestions, renderTemplateBody, replyWindowOpen } from '../../../composables/inbox/inboxWindow'

const filename = new URL('../InboxComposer.vue', import.meta.url).pathname
const NOW = Date.parse('2026-10-28T12:00:00Z')
const TEMPLATE = { id: 7, name: 'reminder', language: 'ar', category: 'UTILITY', status: 'APPROVED', body: 'مرحبا {{1}}', param_count: 1 }

// The component script is compiled and run against stubbed composables, as the other component tests do.
function mountComposer(endsAt: string | null, store = new Map<string, string>()) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-composer' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const inboxDrafts = createInboxDrafts(() => ({ getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k), key: i => [...store.keys()][i] ?? null, length: store.size }))
  const sendReply = vi.fn(async (_body: Record<string, unknown>) => ({}))
  const sendNote = vi.fn(async (_body: Record<string, unknown>) => ({}))
  const mounted: Array<() => void> = []
  const unmounting: Array<() => void> = []
  const templatesEnabled = Vue.ref(false)
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
    onMounted: (fn: () => void) => mounted.push(fn), onBeforeUnmount: (fn: () => void) => unmounting.push(fn),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }), useMe: () => ({ me: Vue.ref({ id: 3 }) }),
    inboxDrafts, cannedSuggestions, renderTemplateBody, replyWindowOpen,
    useSendInboxReply: () => ({ mutateAsync: sendReply, isPending: Vue.ref(false) }), useSendInboxNote: () => ({ mutateAsync: sendNote, isPending: Vue.ref(false) }),
    useInboxCannedReplies: () => ({ data: Vue.ref({ items: [], total: 0 }) }),
    useInboxTemplates: (_channel: unknown, enabled: Vue.Ref<boolean>) => { templatesEnabled.value = enabled.value; return { data: Vue.ref({ items: [TEMPLATE], total: 1 }), isLoading: Vue.ref(false), isError: Vue.ref(false), refetch: vi.fn() } },
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const props = Vue.reactive({ conversation: { id: 5, channel: { id: 1 }, reply_window_ends_at: endsAt } })
  const scope = Vue.effectScope()
  const state = scope.run(() => component.setup(props, { expose: () => {}, emit: () => {} }))
  for (const fn of mounted) fn()
  return { state, props, store, sendReply, sendNote, inboxDrafts, unmount: () => { for (const fn of unmounting) fn(); scope.stop() } }
}

describe('InboxComposer', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => vi.useRealTimers())

  it('switches to the template picker when the reply window expires, without any other change', async () => {
    const { state, unmount } = mountComposer('2026-10-28T12:00:10Z')
    expect(state.templateMode.value).toBe(false)
    vi.advanceTimersByTime(9_000)
    expect(state.templateMode.value).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(state.templateMode.value).toBe(true)
    unmount()
  })

  it('reschedules when a new inbound message moves the window end, and stops its timer on unmount', async () => {
    const { state, props, unmount } = mountComposer('2026-10-28T12:00:10Z')
    props.conversation.reply_window_ends_at = '2026-10-28T12:01:00Z'
    await Vue.nextTick()
    vi.advanceTimersByTime(20_000)
    expect(state.templateMode.value).toBe(false)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is in template mode at once when the window never opened or already closed', () => {
    expect(mountComposer(null).state.templateMode.value).toBe(true)
    expect(mountComposer('2026-10-27T11:00:00Z').state.templateMode.value).toBe(true)
  })

  it('stores reply and note drafts per conversation and restores them on the next mount', async () => {
    const first = mountComposer('2026-10-28T20:00:00Z')
    first.state.draft.value = 'مرحبا بك'
    first.state.mode.value = 'note'
    first.state.draft.value = 'ملاحظة'
    await Vue.nextTick()
    expect(first.inboxDrafts.get(3, 5)).toMatchObject({ reply: 'مرحبا بك', note: 'ملاحظة' })
    expect(first.inboxDrafts.get(3, 6).reply).toBe('')
    first.unmount()

    // The same user opening the same conversation again gets both texts back; another conversation starts empty.
    const reopened = mountComposer('2026-10-28T20:00:00Z', first.store)
    expect(reopened.state.draft.value).toBe('مرحبا بك')
    reopened.state.mode.value = 'note'
    expect(reopened.state.draft.value).toBe('ملاحظة')
  })

  it('clears the draft only after a successful send and keeps it when the send fails', async () => {
    const { state, sendReply, inboxDrafts } = mountComposer('2026-10-28T20:00:00Z')
    state.draft.value = 'رد'
    sendReply.mockRejectedValueOnce(new Error('closed'))
    await state.submit()
    expect(state.draft.value).toBe('رد')
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5).reply).toBe('رد')
    await state.submit()
    expect(sendReply).toHaveBeenLastCalledWith({ body: 'رد' })
    expect(state.draft.value).toBe('')
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5).reply).toBe('')
  })

  it('keeps template parameters as a draft and clears them after the template is sent', async () => {
    const { state, sendReply, inboxDrafts } = mountComposer(null)
    state.templateId.value = TEMPLATE.id
    await Vue.nextTick()
    state.params.value = ['فهد']
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5)).toMatchObject({ templateId: 7, params: ['فهد'] })
    await state.submit()
    expect(sendReply).toHaveBeenCalledWith({ template_id: 7, params: ['فهد'] })
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5)).toMatchObject({ templateId: null, params: [] })
  })
})
