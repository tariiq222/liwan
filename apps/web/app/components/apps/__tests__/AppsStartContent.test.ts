import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../AppsStartContent.vue')
const SharedLinkCard = Vue.defineComponent({
  inheritAttrs: false,
  props: { to: { type: String, default: '' }, title: { type: String, default: '' } },
  setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, props.title),
})
const messages = { 'appStart.attention': 'يحتاج انتباهك', 'appStart.start': 'ابدأ من هنا', page: 'الطلبات', create: 'طلب جديد' }
const row = (id: string, tone: 'urgent' | 'normal' = 'normal') => ({ id, label: `بند ${id}`, to: `/r/${id}`, tone, module: 'operations', work: 'decide' as const, caption: 'غدًا' })
const card = (to: string, labelKey: string) => ({ id: to, labelKey, icon: 'i-lucide-files' as const, to })
const render = (props: Record<string, unknown>) => renderShared(file, props, {}, { messages, stubs: { ...DEFAULT_STUBS, SharedLinkCard } })

describe('AppsStartContent', () => {
  it('shows the attention rows above the start links', async () => {
    const html = await render({ attention: [row('a', 'urgent'), row('b')], cards: [card('/operations', 'page')], creates: [card('/operations/new', 'create')] })
    expect(html.match(/data-testid="app-start-attention-row"/g)).toHaveLength(2)
    expect(html).toContain('to="/r/a"')
    expect(html).toContain('غدًا')
    expect(html.indexOf('يحتاج انتباهك')).toBeLessThan(html.indexOf('ابدأ من هنا'))
    expect(html).toContain('href="/operations"')
    expect(html).toContain('href="/operations/new"')
    expect(html.match(/data-testid="app-start-card"/g)).toHaveLength(1)
    expect(html.match(/data-testid="app-start-create"/g)).toHaveLength(1)
  })

  it('hides the attention section when nothing needs attention', async () => {
    const html = await render({ attention: [], cards: [card('/operations', 'page')], creates: [] })
    expect(html).not.toContain('app-start-attention')
    expect(html).not.toContain('يحتاج انتباهك')
    expect(html).toContain('ابدأ من هنا')
  })

  it('hides the start section when there are no links', async () => {
    expect(await render({ attention: [row('a')], cards: [], creates: [] })).not.toContain('app-start-links')
  })
})
