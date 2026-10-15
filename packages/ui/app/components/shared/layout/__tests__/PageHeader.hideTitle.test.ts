import * as Vue from 'vue'
import { h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const registerTitle = vi.fn()
const escapeTarget = vi.fn()
function options(frameOwnsHeading = false): SharedRenderOptions {
  return {
    globals: {
      usePageHeader: registerTitle,
      useEscapeBack: escapeTarget,
      useProjectFrameHeading: () => Vue.ref(frameOwnsHeading),
    },
  }
}
const actions = { actions: () => h('button', 'Create') }
// SSR marks slot boundaries with comments; the assertions read the markup without them.
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedPageHeader hideTitle', () => {
  it('still draws the heading, description and back control by default', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks', description: 'All tasks', backTo: '/projects', backLabel: 'Back to projects' }, actions, options()))
    expect(html).toMatch(/<h1[^>]*>Tasks<\/h1>/)
    expect(html).toContain('All tasks')
    expect(html).toContain('href="/projects"')
  })

  it('still demotes to h2 under a frame that owns the heading', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks' }, actions, options(true)))
    expect(html).toMatch(/<h2[^>]*>Tasks<\/h2>/)
    expect(html).not.toContain('<h1')
  })

  it('draws the actions alone when the title is hidden', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks', description: 'All tasks', backTo: '/projects', hideTitle: true }, actions, options()))
    expect(html).toContain('data-slot="page-header"')
    expect(html).toContain('<button>Create</button>')
    expect(html).not.toMatch(/<h[12]/)
    expect(html).not.toContain('All tasks')
    expect(html).not.toContain('href="/projects"')
  })

  it('draws nothing when the title is hidden and there is nothing else to show', async () => {
    const html = clean(await renderShared('PageHeader', { title: 'Tasks', hideTitle: true }, {}, options()))
    expect(html).not.toContain('page-header')
    expect(html).not.toMatch(/<h[12]/)
  })

  it('keeps naming the page for the shell and keeps the Escape target', async () => {
    registerTitle.mockClear()
    escapeTarget.mockClear()
    await renderShared('PageHeader', { title: 'Tasks', description: 'All tasks', backTo: '/projects', hideTitle: true }, {}, options())
    const [title, description] = registerTitle.mock.calls[0]!
    expect(title()).toBe('Tasks')
    expect(description()).toBe('All tasks')
    expect(escapeTarget.mock.calls[0]![0]()).toBe('/projects')
  })
})
