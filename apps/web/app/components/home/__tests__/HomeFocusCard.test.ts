import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../HomeFocusCard.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const UBadge = Vue.defineComponent({ inheritAttrs: false, props: { label: { type: String, default: '' }, color: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('span', { ...attrs, 'data-color': props.color }, props.label) })
const messages = { 'home.focusUrgent': 'عاجل', 'home.indicator.execute': 'للتنفيذ', 'home.indicator.decide': 'للقرار', 'home.focusAction.execute': 'افتح', 'home.focusAction.decide': 'راجع' }
const row = (extra: Record<string, unknown> = {}) => ({ id: 'tasks:1', label: 'تجهيز عقد متجر وردة', to: '/my-tasks/1', tone: 'normal', module: 'tasks', work: 'execute', caption: 'مستحقة اليوم', ...extra })
const render = (props: Record<string, unknown>) => renderShared(file, { appLabel: 'مهامي', appIcon: 'i-lucide-check-square', ...props }, {}, { messages, stubs: { ...DEFAULT_STUBS, NuxtLink, UBadge } })

describe('HomeFocusCard', () => {
  it('names the application, links the title to the record and shows the caption', async () => {
    const html = await render({ row: row() })
    expect(html).toContain('data-app="tasks"')
    expect(html).toContain('>مهامي</small>')
    expect(html).toMatch(/href="\/my-tasks\/1"[^>]*>تجهيز عقد متجر وردة</)
    expect(html).toContain('مستحقة اليوم')
    expect(html).toContain('liwan-app-tile')
  })

  it('says what kind of work it is, and what opening it asks of the person', async () => {
    const html = await render({ row: row({ work: 'decide' }) })
    expect(html).toContain('>للقرار<')
    expect(html).toContain('>راجع<')
    expect(html).toContain('data-color="neutral"')
  })

  it('marks an urgent row with a warm pill', async () => {
    const html = await render({ row: row({ tone: 'urgent' }) })
    expect(html).toContain('>عاجل<')
    expect(html).toContain('data-color="warning"')
  })

  it('leaves out the caption when there is none', async () => {
    expect(await render({ row: row({ caption: undefined }) })).not.toContain('مستحقة اليوم')
  })
})
