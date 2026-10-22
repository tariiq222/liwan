import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import * as aiMarkdown from '../../../utils/aiMarkdown'
import * as aiMarkdownRender from '../../../utils/aiMarkdownRender'
import * as aiSuggestions from '../../../utils/aiSuggestions'
import * as aiThread from '../../../utils/aiThread'
import * as aiContext from '../../../utils/aiContext'

const file = resolve(import.meta.dirname, '../AiSheet.vue')
const marker = (tag: string, attrName: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, { [attrName]: '', 'data-compact': attrs.compact === undefined ? undefined : 'true' }, slots.default?.()) })
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const stubs = {
  ...DEFAULT_STUBS, NuxtLink,
  SharedEmptyState: Vue.defineComponent({ props: { title: String }, setup: (props, { attrs }) => () => Vue.h('div', attrs, props.title) }),
}

const messages = {
  'ai.sheet.now.title': 'في هذه الصفحة الآن', 'ai.sheet.now.hide': 'إخفاء', 'ai.sheet.now.show': 'إظهار', 'ai.sheet.now.empty': 'لا شيء يحتاج انتباهك في هذه الصفحة.',
  'ai.sheet.conversation': 'المحادثة', 'ai.suggestionLabel': 'اقتراح', 'ai.glance.urgent': 'عاجل', 'ai.errors.unavailable': 'غير متاح',
  'ai.history.new': 'محادثة جديدة', 'ai.note': 'يقترح ويوضّح فقط، ولا يعتمد أو يرسل أي شيء عنك.', 'ai.prompt': 'كيف أساعدك؟',
  'ai.starters.label': 'أسئلة', 'ai.starters.overdue': 'ما المتأخر؟', 'ai.followUps.label': 'متابعة', 'ai.followUps.summary': 'لخّص',
}

interface Row { id: string; label: string; to: string; tone: 'urgent' | 'normal'; caption?: string; suggestion?: string; module: string }
interface Options {
  rows?: Row[]; pending?: boolean; failed?: boolean; hidden?: boolean; module?: string | null; items?: unknown[]; runId?: string | null
  aiEnabled?: boolean; limit?: string | null; unavailable?: boolean; shown?: boolean
}
const row = (id: string, tone: Row['tone'] = 'normal', extra: Partial<Row> = {}): Row => ({ id, label: `بند ${id}`, to: `/${id}`, tone, module: 'tasks', ...extra })

async function render({ rows = [], pending = false, failed = false, hidden = false, module = 'tasks', items = [], runId = null, aiEnabled = true, limit = null, unavailable = false, shown = true }: Options = {}) {
  const useAttention = vi.fn(() => ({ rows: Vue.computed(() => rows), pending: Vue.computed(() => pending), failed: Vue.computed(() => failed) }))
  const activeModule = Vue.ref(module)
  const run = { runId: Vue.ref(runId), status: Vue.ref('idle'), items: Vue.ref(items), limit: Vue.ref(limit), error: Vue.ref(null), unavailable: Vue.ref(unavailable), send: vi.fn(), decide: vi.fn(), load: vi.fn(), reset: vi.fn() }
  const follow = vi.fn(() => ({ startNew: vi.fn() }))
  const html = await renderShared(file, {}, {}, {
    messages, stubs,
    globals: {
      useRoute: () => ({ path: '/tasks' }), useRouter: () => ({ push: vi.fn() }),
      useRuntimeConfig: () => ({ public: { aiEnabled } }), useToast: () => ({ add: () => {} }),
      resolveComponent: () => NuxtLink, onMounted: () => undefined,
      UIcon: undefined,
    },
    modules: {
      '@/components/ai/AiAvatar.vue': { __esModule: true, default: marker('i', 'data-avatar') },
      '@/components/ai/AiComposer.vue': { __esModule: true, default: marker('form', 'data-composer') },
      '@/components/ai/AiConfirmCard.vue': { __esModule: true, default: marker('div', 'data-confirm') },
      '@/components/ai/AiCopyButton.vue': { __esModule: true, default: marker('b', 'data-copy') },
      '@/components/ai/AiDraftCard.vue': { __esModule: true, default: marker('div', 'data-draft') },
      '@/components/ai/AiLimitNotice.vue': { __esModule: true, default: marker('div', 'data-limit') },
      '@/components/ai/AiMessage.vue': { __esModule: true, default: Vue.defineComponent({ props: ['role', 'text', 'compact'], setup: (props, { slots }) => () => Vue.h('article', { 'data-role': props.role, 'data-compact': props.compact === undefined ? undefined : 'true' }, [props.text, slots.footer?.()]) }) },
      '@/components/ai/AiRecordCards.vue': { __esModule: true, default: marker('div', 'data-records') },
      '@/components/ai/AiSuggestionChips.vue': { __esModule: true, default: Vue.defineComponent({ props: ['items'], setup: (props) => () => Vue.h('ul', { 'data-chips': (props.items as string[]).join('|') }) }) },
      '@/components/ai/AiToolTrace.vue': { __esModule: true, default: marker('div', 'data-trace') },
      '@/composables/useAiConversation': { followSharedConversation: follow },
      '@/composables/useAiNowSection': { useAiNowSection: () => ({ hidden: Vue.ref(hidden), toggle: () => undefined }) },
      '@/composables/useAiRun': { useAiRun: () => run },
      '@/composables/useAssistantSheet': { assistantContext: (_path: string, id: string | null) => id, useAssistantSheet: () => ({ shown: Vue.ref(shown) }) },
      '@/composables/useAttention': { useAttention },
      '@/composables/useShellModel': { useShellModel: () => ({ activeModule }) },
      '@/utils/aiContext': aiContext, '@/utils/aiDraft': { prepareDraftHandoff: () => ({}), readCreatedId: () => null },
      '@/utils/aiSuggestions': aiSuggestions, '@/utils/aiThread': aiThread,
      '@/utils/aiMarkdown': aiMarkdown, '@/utils/aiMarkdownRender': aiMarkdownRender,
    },
  })
  return { html, useAttention, run, follow }
}

describe('AiSheet "in this page now"', () => {
  it('lists the rows as links to their records, each with its dot and caption, and no counts', async () => {
    const { html } = await render({ rows: [row('a', 'urgent', { caption: 'تأخرت يومين' }), row('b'), row('c')] })
    expect(html.match(/data-testid="ai-sheet-now-row"/g)).toHaveLength(3)
    expect(html).toContain('href="/a"')
    expect(html).toContain('تأخرت يومين')
    expect(html).toContain('bg-warning')
    expect(html).toContain('bg-primary')
    expect(html).toContain('عاجل')
    expect(html).not.toMatch(/\d+ (مهمة|بنود|بند)/)
  })

  it('asks for the module of the page the user is in, three rows at most', async () => {
    const { useAttention } = await render({ module: 'hr' })
    const [scope, options] = useAttention.mock.calls[0] as unknown as [{ value: string }, { limit: number }]
    expect(scope.value).toBe('hr')
    expect(options).toEqual({ limit: 3 })
  })

  it('shows one plain suggestion sentence, taken from the first row that has one, and no action button for it', async () => {
    const { html } = await render({ rows: [row('a'), row('b', 'normal', { suggestion: 'راجع المهمة أولًا' }), row('c', 'normal', { suggestion: 'لا تظهر' })] })
    expect(html.match(/data-testid="ai-sheet-suggestion"/g)).toHaveLength(1)
    expect(html).toContain('راجع المهمة أولًا')
    expect(html).not.toContain('لا تظهر')
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it('shows no suggestion box when no row has one', async () => {
    expect((await render({ rows: [row('a')] })).html).not.toContain('ai-sheet-suggestion')
  })

  it('says nothing needs attention when there are no rows', async () => {
    expect((await render()).html).toContain('لا شيء يحتاج انتباهك في هذه الصفحة.')
  })

  it('shows a skeleton row while loading, not the empty line', async () => {
    const { html } = await render({ pending: true })
    expect(html).toContain('ai-sheet-now-skeleton')
    expect(html).not.toContain('ai-sheet-now-empty')
  })

  it('looks across every module on home', async () => {
    const { useAttention } = await render({ module: 'home' })
    expect((useAttention.mock.calls[0] as unknown as [{ value: string }])[0].value).toBe('all')
  })

  it.each(['settings', null])('hides the whole section, not an empty message, on %s', async (module) => {
    const { html, useAttention } = await render({ module })
    expect((useAttention.mock.calls[0] as unknown as [{ value: unknown }])[0].value).toBeNull()
    expect(html).not.toContain('ai-sheet-now')
    expect(html).not.toContain('لا شيء يحتاج انتباهك')
    expect(html).toContain('المحادثة')
  })

  it('shows nothing, not an error, when every provider failed', async () => {
    const { html } = await render({ failed: true, rows: [row('a')] })
    expect(html).not.toContain('ai-sheet-now-row')
    expect(html).not.toContain('ai-sheet-now-empty')
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('في هذه الصفحة الآن')
  })

  it('folds to its title row when hidden, and the button offers to show it', async () => {
    const { html } = await render({ hidden: true, rows: [row('a', 'normal', { suggestion: 'اقتراح' })] })
    expect(html).toContain('في هذه الصفحة الآن')
    expect(html).toContain('إظهار')
    expect(html).not.toContain('ai-sheet-now-row')
    expect(html).not.toContain('ai-sheet-suggestion')
    expect(html).toContain('aria-expanded="false"')
  })

  it('replaces its rows when the page changes and leaves the thread exactly as it was', async () => {
    const items = [{ kind: 'user', text: 'سؤال' }, { kind: 'assistant', text: 'جواب', records: [], streaming: false }]
    const onTasks = await render({ module: 'tasks', rows: [row('a')], items, runId: 'r1' })
    const onHr = await render({ module: 'hr', rows: [row('z')], items, runId: 'r1' })
    expect(onTasks.html).toContain('href="/a"')
    expect(onHr.html).toContain('href="/z"')
    const thread = (html: string) => html.match(/role="log".*/s)![0].split('</div></div>')[0]!
    expect(thread(onHr.html)).toBe(thread(onTasks.html))
    expect(thread(onHr.html).match(/<article/g) ?? []).toHaveLength(2)
    for (const { run } of [onTasks, onHr]) {
      expect(run.send).not.toHaveBeenCalled()
      expect(run.reset).not.toHaveBeenCalled()
    }
  })
})

describe('AiSheet conversation', () => {
  it('has a conversation divider, the composer in its compact form and the advice-only note', async () => {
    const { html } = await render()
    expect(html).toContain('المحادثة')
    expect(html).toContain('data-composer')
    expect(html).toContain('data-compact')
    expect(html).toContain('يقترح ويوضّح فقط')
  })

  it('offers the starter questions when empty, and follow-ups for the page after a reply', async () => {
    const empty = await render()
    expect(empty.html).toContain('data-chips="ما المتأخر؟|')
    expect(empty.html).not.toContain('ai-sheet-new')
    const talking = await render({ module: 'hr', items: [{ kind: 'user', text: 'س' }, { kind: 'assistant', text: 'ج', records: [], streaming: false }] })
    expect(talking.html).toContain('data-chips="لخّص|')
    expect(talking.html).toContain('ai-sheet-new')
    const onTasks = await render({ items: [{ kind: 'user', text: 'س' }, { kind: 'assistant', text: 'ج', records: [], streaming: false }] })
    expect(onTasks.html).toContain('data-chips="ai.followUps.taskBlockers|')
  })

  it('draws the thread with the page\'s own parts, compact', async () => {
    const { html } = await render({ items: [
      { kind: 'user', text: 'س' },
      { kind: 'assistant', text: 'ج', records: [{ type: 'task', id: 1, label: 'م' }], streaming: false },
      { kind: 'confirm', callId: 'c1', tool: 't', input: {}, summaryAr: 'ا', summaryEn: 'a', state: 'pending' },
      { kind: 'draft', callId: 'c2', tool: 't', payload: {}, summaryAr: 'ا', summaryEn: 'a', state: 'pending' },
    ] })
    for (const part of ['data-role="user"', 'data-role="assistant"', 'data-records', 'data-copy', 'data-confirm', 'data-draft']) expect(html).toContain(part)
    expect(html).toContain('data-compact="true"')
  })

  it('follows the shared conversation only while shown and the assistant is on', async () => {
    const enabledOf = async (options: Options) => (((await render(options)).follow.mock.calls[0] as unknown as [unknown, () => boolean])[1])()
    expect(await enabledOf({})).toBe(true)
    expect(await enabledOf({ shown: false })).toBe(false)
    expect(await enabledOf({ aiEnabled: false })).toBe(false)
  })

  it('shows the unavailable state instead of the body when the assistant is off', async () => {
    const off = await render({ aiEnabled: false })
    expect(off.html).toContain('ai-sheet-unavailable')
    expect(off.html).not.toContain('ai-sheet-now')
    const down = await render({ unavailable: true })
    expect(down.html).toContain('ai-sheet-unavailable')
  })
})
