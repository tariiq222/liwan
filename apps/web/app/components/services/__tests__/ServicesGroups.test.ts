import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import type { ServiceGroup } from '../../../composables/nav/servicesStartModel'

const file = resolve(import.meta.dirname, '../ServicesGroups.vue')
const SharedLinkCard = Vue.defineComponent({
  inheritAttrs: false,
  props: { to: { type: String, default: '' }, title: { type: String, default: '' }, description: { type: String, default: '' } },
  setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, `${props.title}|${props.description}`),
})
const messages = { 'nav.hr': 'الموارد البشرية', 'operations.title': 'العمليات', a: 'طلب إجازة', 'a.d': 'قدّم طلبًا', b: 'طلباتي', 'b.d': 'تابع طلباتك' }
const groups: ServiceGroup[] = [
  { id: 'hr', labelKey: 'nav.hr', icon: 'i-lucide-users', entries: [{ id: 'x', labelKey: 'a', descriptionKey: 'a.d', icon: 'i-lucide-calendar-plus', to: '/hr/leave/new', capability: 'hr.leave.request' }] },
  { id: 'operations', labelKey: 'operations.title', icon: 'i-lucide-workflow', entries: [{ id: 'y', labelKey: 'b', descriptionKey: 'b.d', icon: 'i-lucide-files', to: '/operations', capability: 'operations.requests.read' }] },
]
const render = (value: ServiceGroup[]) => renderShared(file, { groups: value }, {}, { messages, stubs: { ...DEFAULT_STUBS, SharedLinkCard } })

describe('ServicesGroups', () => {
  it('draws one titled section per application with a link card per entry', async () => {
    const html = await render(groups)
    expect(html.match(/data-testid="services-group"/g)).toHaveLength(2)
    expect(html.indexOf('الموارد البشرية')).toBeLessThan(html.indexOf('العمليات'))
    expect(html).toContain('href="/hr/leave/new"')
    expect(html).toContain('طلب إجازة|قدّم طلبًا')
    expect(html).toContain('href="/operations"')
    expect(html.match(/data-testid="service-entry"/g)).toHaveLength(2)
  })

  it('names each section by its heading', async () => {
    const html = await render(groups)
    expect(html).toMatch(/aria-labelledby="services-group-hr"/)
    expect(html).toMatch(/<h2 id="services-group-hr"/)
  })

  it('draws nothing for no groups', async () => {
    expect(await render([])).not.toContain('services-group"')
  })
})
