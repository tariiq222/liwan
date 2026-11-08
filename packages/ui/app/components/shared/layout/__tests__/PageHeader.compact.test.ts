import * as Vue from 'vue'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const options: SharedRenderOptions = {
  globals: {
    usePageHeader: () => undefined,
    useEscapeBack: () => undefined,
    useFrameOwnsHeading: () => Vue.ref(false),
    usePageApp: () => Vue.ref({ icon: 'i-lucide-folder-kanban', id: 'projects', label: 'Projects', to: '/projects', tagline: 'One place for projects' }),
  },
}
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedPageHeader compact and trail', () => {
  it('keeps the tile and the tagline by default', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Alpha' }, {}, options))
    expect(html).toContain('data-slot="page-header-chip"')
    expect(html).toContain('One place for projects')
  })

  it('draws neither the tile nor the tagline when compact, with the smaller title', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Alpha', compact: true }, {}, options))
    expect(html).not.toContain('page-header-chip')
    expect(html).not.toContain('One place for projects')
    expect(html).toContain('--liwan-fs-title')
    expect(html).not.toContain('--liwan-fs-display')
  })

  it('draws an explicit trail as given, with its test ids, instead of the published ancestors and the back step', async () => {
    const trail = [{ label: 'Projects', to: '/projects', testId: 'crumb-projects' }, { label: 'Alpha' }]
    const html = clean(await renderShared('PageHeader', { title: 'Alpha', trail, backTo: '/elsewhere', backLabel: 'Elsewhere' }, { actions: () => h('b', 'x') }, options))
    expect(html).toContain('data-testid="crumb-projects"')
    expect(html).toContain('href="/projects"')
    expect(html).not.toContain('/elsewhere')
  })
})
