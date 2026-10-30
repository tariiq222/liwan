import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, fakeT, renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as aiMarkdown from '../../../utils/aiMarkdown'
import * as aiMarkdownRender from '../../../utils/aiMarkdownRender'

const file = (name: string) => resolve(import.meta.dirname, `../${name}.vue`)
const marker = (tag: string, attrName: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h(tag, { [attrName]: '', 'data-size': attrs.size }) })
const stubs = {
  ...DEFAULT_STUBS,
  AiAvatar: marker('i', 'data-avatar'),
  AiTypingDots: marker('b', 'data-typing'),
  UTextarea: Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('textarea', { rows: attrs.rows, 'data-testid': attrs['data-testid'] }) }),
}
const modules = { '@/utils/aiMarkdown': aiMarkdown, '@/utils/aiMarkdownRender': aiMarkdownRender }
const messages = { 'ai.thread.you': 'أنت', 'ai.thread.assistant': 'المساعد', 'ai.thread.records': 'المصادر', 'ai.context.chip': 'من صفحة: {page}', 'ai.context.pages.project': 'مشروع' }
const globals = { resolveComponent: () => DEFAULT_STUBS.NuxtLink!, useI18n: () => ({ t: fakeT(messages), te: (key: string) => key in messages }), useToast: () => ({ add: () => {} }) }
const render = (name: string, props: Record<string, unknown>, slots = {}) => renderShared(file(name), props, slots, { stubs, modules, messages, globals })

describe('AiMessage', () => {
  it('shows the user message as a bubble without the assistant mark', async () => {
    const html = await render('AiMessage', { role: 'user', text: 'ما مهامي؟' })
    expect(html).toContain('ما مهامي؟')
    expect(html).toContain('self-start')
    expect(html).not.toContain('data-avatar')
  })

  it('shows the assistant reply as plain text beside its mark, with the footer slot under it', async () => {
    const html = await render('AiMessage', { role: 'assistant', text: 'عندك مهمتان' }, { footer: () => Vue.h('em', 'مصادر') })
    expect(html).toContain('data-avatar')
    expect(html).toContain('عندك مهمتان')
    expect(html).toContain('<em>مصادر</em>')
    expect(html).not.toContain('bg-(--liwan-nav-active)')
    expect(html).not.toContain('data-typing')
  })

  it('shows the typing dots and marks the article busy while streaming', async () => {
    const html = await render('AiMessage', { role: 'assistant', text: '', streaming: true })
    expect(html).toContain('data-typing')
    expect(html).toContain('aria-busy="true"')
  })

  it('uses the smaller type when compact', async () => {
    expect(await render('AiMessage', { role: 'assistant', text: 'نص', compact: true })).toContain('text-sm')
    expect(await render('AiMessage', { role: 'assistant', text: 'نص' })).toContain('text-base')
  })
})

describe('AiRecordCards', () => {
  it('numbers the sources and links only the records that have a page', async () => {
    const html = await render('AiRecordCards', { records: [{ type: 'project', id: 12, label: 'بوابة العملاء' }, { type: 'task', id: 5, label: 'تقرير' }, { type: 'invoice', id: 9, label: 'فاتورة' }] })
    expect(html.match(/data-testid="ai-record"/g)).toHaveLength(3)
    expect(html).toContain('to="/projects/12"')
    expect(html).toContain('to="/tasks/5"')
    expect(html.match(/<a /g)).toHaveLength(2)
    expect(html).toMatch(/>1<\/span><span[^>]*>بوابة العملاء</)
    expect(html).toMatch(/>3<\/span><span[^>]*>فاتورة</)
  })
})

describe('AiSuggestionChips', () => {
  it('lists the questions as buttons, disabled together', async () => {
    const html = await render('AiSuggestionChips', { items: ['س1', 'س2'], label: 'أسئلة', disabled: true })
    expect(html.match(/data-testid="ai-suggestion"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="أسئلة"')
    expect(html.match(/disabled/g)).toHaveLength(2)
  })

  it('renders nothing without questions', async () => {
    expect(await render('AiSuggestionChips', { items: [], label: 'أسئلة' })).not.toContain('<ul')
  })
})

describe('AiComposer', () => {
  it('has two rows on the page and one when compact', async () => {
    expect(await render('AiComposer', { disabled: false, pending: false })).toContain('rows="2"')
    expect(await render('AiComposer', { disabled: false, pending: false, compact: true })).toContain('rows="1"')
  })
})

describe('AiContextChip', () => {
  it('names the page the conversation came from, falling back to the raw page', async () => {
    expect(await render('AiContextChip', { page: 'project' })).toContain('من صفحة: مشروع')
    expect(await render('AiContextChip', { page: 'zzz' })).toContain('من صفحة: zzz')
  })
})
