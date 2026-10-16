import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { AI_RUN_TITLE_MAX_CHARS, AiRunPatchSchema } from '@nasq/contracts'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../composables/useApi'

const filename = resolve(import.meta.dirname, '../AiRunList.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const script = compileScript(descriptor, { id: 'ai-run-list' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'ai-run-list', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', js(template.code))(Vue)

const NOON_TODAY = new Date(new Date().setHours(12, 0, 0, 0)).toISOString()
const OLD = '2026-01-05T08:30:00.000Z'
const messages: Record<string, string> = {
  'ai.history.title': 'محادثات أخيرة', 'ai.history.new': 'محادثة جديدة', 'ai.history.empty': 'لا محادثات بعد',
  'ai.history.waiting': 'بانتظار قرارك', 'ai.history.failed': 'تعذّر إكمالها', 'ai.history.untitled': 'بلا عنوان',
  'ai.history.emptyArchived': 'لا مؤرشفة', 'ai.history.views.label': 'عرض', 'ai.history.views.active': 'المحادثات', 'ai.history.views.archived': 'المؤرشفة',
  'ai.history.actions.menu': 'خيارات', 'ai.history.actions.rename': 'تغيير الاسم', 'ai.history.actions.archive': 'أرشفة', 'ai.history.actions.unarchive': 'إلغاء الأرشفة',
}
const runs = [
  { run_id: 'r_1', title: 'ما مهامي؟', status: 'done', updated_at: NOON_TODAY, archived: false },
  { run_id: 'r_2', title: 'جهّز مشروعًا', status: 'waiting_user', updated_at: OLD, archived: false },
  { run_id: 'r_3', title: 'خطأ', status: 'failed', updated_at: OLD, archived: false },
  { run_id: 'r_4', title: null, status: 'done', updated_at: OLD, archived: false },
]

async function renderList(options: { runs?: typeof runs; run?: string; loading?: boolean; error?: unknown; hydrated?: boolean } = {}) {
  const bindings = {
    ...Vue, exports: {}, _defineComponent: Vue.defineComponent, ApiError, AI_RUN_TITLE_MAX_CHARS, AiRunPatchSchema,
    useToast: () => ({ add: () => {} }), useAiRunActions: () => ({ rename: async () => {}, setArchived: async () => {} }),
    formatDate: (value: string) => `D:${value.slice(0, 10)}`, formatTime: (value: string) => `T:${new Date(value).getHours()}`,
    useAiRuns: () => ({ data: Vue.ref(options.error || options.loading ? undefined : { items: options.runs ?? runs, total: (options.runs ?? runs).length }), isLoading: Vue.ref(options.loading ?? false), isError: Vue.ref(Boolean(options.error)), error: Vue.ref(options.error), refetch: () => {} }),
    useRoute: () => ({ query: options.run ? { run: options.run } : {} }),
    useI18n: () => ({ t: (key: string) => messages[key] ?? key }),
    useHydrated: () => Vue.ref(options.hydrated !== false),
  }
  const component = new Function(...Object.keys(bindings), js(script))(...Object.values(bindings))
  const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...component.setup({}, { expose: () => {}, emit: () => {} }) }), render }))
  app.component('NuxtLink', Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { ...attrs, to: undefined, href: `${(attrs.to as any).path}?run=${(attrs.to as any).query.run}` }, slots.default?.()) }))
  app.component('UButton', Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('a', { href: attrs.to as string, 'data-testid': attrs['data-testid'] as string }, String(attrs.label)) }))
  app.component('SharedRowActions', Vue.defineComponent({
    inheritAttrs: false,
    props: ['actions', 'label'],
    setup: props => () => Vue.h('div', { 'data-testid': 'row-actions', 'aria-label': props.label }, props.actions.map((action: { label: string }) => Vue.h('i', action.label))),
  }))
  app.component('SharedPageState', Vue.defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs, slots }) => () => attrs.loading ? Vue.h('p', 'loading') : attrs.error ? Vue.h('p', 'error') : attrs.empty ? Vue.h('p', String(attrs['empty-text'])) : slots.default?.(),
  }))
  return renderToString(app)
}

describe('AiRunList', () => {
  it('lists the titles with a time for today and a date for older runs, linking each to its run', async () => {
    const html = await renderList()
    expect(html).toContain('ما مهامي؟')
    expect(html).toContain('T:12')
    expect(html).toContain('D:2026-01-05')
    expect(html).toContain('href="/ai?run=r_2"')
    expect(html).toContain('بلا عنوان')
  })

  it('offers a new conversation that goes to /ai without a run', async () => {
    expect(await renderList()).toMatch(/<a href="\/ai" data-testid="ai-new-run">محادثة جديدة<\/a>/)
  })

  it('hints only at runs waiting for the user or failed, and marks the open one', async () => {
    const html = await renderList({ run: 'r_2' })
    expect(html.match(/بانتظار قرارك/g)).toHaveLength(1)
    expect(html.match(/تعذّر إكمالها/g)).toHaveLength(1)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/href="\/ai\?run=r_2"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/ai\?run=r_2"/)
  })

  it('offers the two views as a labelled group', async () => {
    const html = await renderList()
    expect(html).toMatch(/role="group"[^>]*aria-label="عرض"/)
    expect(html).toMatch(/data-testid="ai-view-active">المحادثات<\/a><a data-testid="ai-view-archived">المؤرشفة</)
  })

  it('gives every row an actions menu named after its conversation, with rename and archive', async () => {
    const html = await renderList()
    expect(html.match(/data-testid="row-actions"/g)).toHaveLength(runs.length)
    expect(html).toContain('<i>تغيير الاسم</i><i>أرشفة</i>')
  })

  it('shows the empty, loading and error states instead of the list', async () => {
    expect(await renderList({ runs: [] })).toContain('لا محادثات بعد')
    expect(await renderList({ loading: true })).not.toContain('ai-run-item')
    expect(await renderList({ error: new Error('x') })).toContain('<p>error</p>')
    expect(await renderList({ hydrated: false })).toContain('<p>loading</p>')
  })
})
