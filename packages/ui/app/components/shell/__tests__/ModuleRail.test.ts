import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import * as scroll from '../../../composables/useScrollEdges'
import { renderShared } from '../../../../test/helpers/renderShared'
const component = resolve(__dirname, '../ModuleRail.vue')
const item = (id: string) => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}` })
const rail = { top: [item('apps'), item('home')], applications: [item('projects'), item('chat')], utility: [item('ai'), item('settings')] }
const render = (props: Record<string, unknown> = {}) => renderShared(component, { rail, activeId: 'projects', homeTo: '/', ...props }, {}, { modules: {
  '../../composables/useScrollEdges': scroll,
  '../shared/layout/BrandWordmark.vue': { __esModule: true, default: Vue.defineComponent({ render: () => Vue.h('span') }) },
} })
describe('ModuleRail', () => {
  it('renders all application links between fixed destinations and utilities', async () => {
    const html = await render()
    const at = (text: string) => html.indexOf(text)
    expect(at('to="/home"')).toBeLessThan(at('to="/projects"'))
    expect(at('to="/chat"')).toBeLessThan(at('to="/ai"'))
    expect(html).toMatch(/<nav[^>]*class="liwan-module-rail-links"[^>]*aria-label="nav.railApps"[^>]*data-group="applications"/)
  })
  it('marks only the active entry and keeps an empty scroller hidden from screen readers', async () => {
    expect((await render()).match(/aria-current="page"/g)).toHaveLength(1)
    expect(await render({ rail: { ...rail, applications: [] } })).toMatch(/aria-hidden="true"[^>]*data-group="applications"/)
  })
  it('names each link by its visible text so voice control and screen readers agree', async () => {
    const html = await render({ rail: { ...rail, applications: [{ ...item('hr'), shortLabelKey: 'nav.railHr' }] } })
    expect(html).toContain('nav.railHr')
    expect(html).not.toMatch(/<a[^>]*class="liwan-module-rail-link"[^>]*aria-label=/)
  })
  it('does not claim overflow before layout has measured it', async () => {
    const html = await render()
    expect(html).not.toContain('data-testid="rail-fade-top"')
    expect(html).not.toContain('data-testid="rail-fade-bottom"')
  })
})
