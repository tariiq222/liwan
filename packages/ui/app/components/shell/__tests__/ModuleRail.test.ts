import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '../../../../test/helpers/renderShared'

const component = resolve(__dirname, '../ModuleRail.vue')
const item = (id: string) => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}` })
const rail = {
  top: [item('apps'), item('home')],
  pinned: [item('projects'), item('chat')],
  customize: { ...item('customize'), to: '/apps' },
  utility: [item('helper'), item('settings')],
}
const render = (props: Record<string, unknown>) => renderShared(component, { rail, activeId: 'projects', homeTo: '/', ...props }, {}, { modules: { '../shared/layout/BrandWordmark.vue': { __esModule: true, default: Vue.defineComponent({ render: () => Vue.h('span') }) } } })

describe('ModuleRail', () => {
  it('labels a scrollable application group without implying user pins in the vendor console', async () => {
    const html = await render({ rail: { ...rail, pinnedLabelKey: 'nav.railApps' } })
    expect(html).toMatch(/<nav[^>]*aria-label="nav.railApps"[^>]*data-group="pinned"/)
    expect(html).not.toContain('nav.pinned')
  })
  it('draws the groups top to bottom: fixed entries, pinned, customize, utility, then the brand', async () => {
    const html = await render({})
    const at = (needle: string) => html.indexOf(needle)
    expect(at('to="/apps"')).toBeLessThan(at('to="/home"'))
    expect(at('to="/home"')).toBeLessThan(at('webvue-module-rail-links'))
    expect(at('to="/projects"')).toBeLessThan(at('to="/chat"'))
    expect(at('to="/chat"')).toBeLessThan(at('aria-label="nav.customize"'))
    expect(at('webvue-module-rail-utility')).toBeGreaterThan(at('nav.customize'))
    expect(at('to="/helper"')).toBeLessThan(at('to="/settings"'))
    expect(at('webvue-module-rail-brand')).toBeGreaterThan(at('to="/settings"'))
  })

  it('labels the pinned run with a non-interactive divider and keeps it only while something is pinned', async () => {
    const html = await render({})
    expect(html).toMatch(/<span[^>]*data-testid="module-rail-pinned-label"[^>]*>nav\.pinned<\/span>/)
    const empty = await render({ rail: { ...rail, pinned: [] } })
    expect(empty).not.toContain('module-rail-pinned-label')
    expect(empty).not.toContain('aria-label="nav.pinned"')
    expect(empty).not.toMatch(/<nav[^>]*data-group="pinned"/)
    // The filler is hidden from assistive technology and still takes the free height, so the utility group stays at the bottom.
    expect(empty).toMatch(/<div[^>]*class="webvue-module-rail-links"[^>]*aria-hidden="true"[^>]*data-group="pinned"|<div[^>]*aria-hidden="true"[^>]*data-group="pinned"/)
    expect(empty).toContain('webvue-module-rail-utility')
  })

  it('marks exactly the active item', async () => {
    const html = await render({ activeId: 'helper' })
    expect(html.match(/data-active="true"/g)).toHaveLength(1)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*to="\/helper"|to="\/helper"[^>]*aria-current="page"/)
  })

  it('lights nothing in the pinned group when the active id is not pinned', async () => {
    const html = await render({ activeId: 'apps' })
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*to="\/apps"|to="\/apps"[^>]*aria-current="page"/)
  })

  it('leaves out the customize group when there is no entry', async () => {
    expect(await render({ rail: { ...rail, customize: null } })).not.toContain('nav.customize')
  })
})
