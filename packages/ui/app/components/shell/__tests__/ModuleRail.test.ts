import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '../../../../test/helpers/renderShared'

const component = resolve(__dirname, '../ModuleRail.vue')
const item = (id: string) => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}` })
const render = (props: Record<string, unknown>) => renderShared(component, { modules: [item('home'), item('projects')], utility: [item('helper'), item('settings')], activeId: 'projects', homeTo: '/', ...props }, {}, { modules: { '../shared/layout/BrandWordmark.vue': { __esModule: true, default: Vue.defineComponent({ render: () => Vue.h('span') }) } } })

describe('ModuleRail', () => {
  it('renders the utility group after the modules group', async () => {
    const html = await render({})
    expect(html.indexOf('webvue-module-rail-links')).toBeGreaterThan(-1)
    expect(html.indexOf('webvue-module-rail-utility')).toBeGreaterThan(html.indexOf('webvue-module-rail-links'))
    expect(html.indexOf('to="/helper"')).toBeLessThan(html.indexOf('to="/settings"'))
    expect(html.indexOf('webvue-module-rail-brand')).toBeGreaterThan(html.indexOf('to="/settings"'))
  })

  it('marks exactly the active item', async () => {
    const html = await render({ activeId: 'helper' })
    expect(html.match(/data-active="true"/g)).toHaveLength(1)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*to="\/helper"|to="\/helper"[^>]*aria-current="page"/)
  })
})
