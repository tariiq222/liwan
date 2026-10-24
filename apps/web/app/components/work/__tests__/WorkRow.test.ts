import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../WorkRow.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const UBadge = Vue.defineComponent({ inheritAttrs: false, props: { label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('span', attrs, props.label) })
const messages = { 'myTasks.work.urgent': 'عاجل' }
const row = (extra = {}) => ({ id: 'tasks-due:task-1', label: 'تقرير الربع', to: '/my-tasks/1', tone: 'normal' as const, module: 'tasks', work: 'execute' as const, ...extra })
const render = (props: Record<string, unknown>) => renderShared(file, props, {}, { messages, stubs: { ...DEFAULT_STUBS, NuxtLink, UBadge } })

describe('WorkRow', () => {
  it('links the label to the record and names the source application', async () => {
    const html = await render({ row: row({ caption: 'تستحق اليوم' }), sourceLabel: 'مهامي' })
    expect(html).toMatch(/href="\/my-tasks\/1"[^>]*>تقرير الربع</)
    expect(html).toMatch(/data-testid="work-row-source"[^>]*>مهامي</)
    expect(html).toContain('تستحق اليوم')
    expect(html).not.toContain('work-row-urgent')
    expect(html).toContain('bg-primary')
  })

  it('draws an urgent row with the warm dot and the urgent pill', async () => {
    const html = await render({ row: row({ tone: 'urgent' }), sourceLabel: 'مهامي' })
    expect(html).toContain('bg-warning')
    expect(html).toMatch(/data-testid="work-row-urgent"[^>]*>عاجل</)
  })

  it('shows the suggestion as plain text, never as a button', async () => {
    const html = await render({ row: row({ suggestion: 'ابدأ بالمتأخرة.' }), sourceLabel: 'مهامي' })
    expect(html).toContain('<p class="mt-1 break-words text-sm text-default">ابدأ بالمتأخرة.</p>')
    expect(html).not.toContain('<button')
  })
})
