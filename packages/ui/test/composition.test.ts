import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type Component, type RenderFunction, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderFilter } from './helpers/filterComponents'
import { sharedFile } from './helpers/renderShared'

const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: '#' } },
  setup(props, { slots }) {
    return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.())
  },
})

function loadShared(name: string): Component {
  const filename = sharedFile(name)
  const source = readFileSync(filename, 'utf8')
  const parsed = parse(source, { filename })
  if (parsed.errors.length) throw parsed.errors[0]
  if (!parsed.descriptor.template) throw new Error(`${name}.vue has no template`)

  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: `shared-${name}`,
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]

  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({
    name,
    props: {
      title: String,
      description: String,
      backTo: [String, Object],
      backLabel: String,
      width: { type: String, default: 'list' },
    },
    setup(props) {
      return {
        props, hideBack: false, headerDescription: props.description,
        // PageContainer derives its band from the prop; the route-shaped flags
        // are presentation hooks, not part of the width vocabulary.
        widthClass: `nasq-page-width-${props.width}`,
        projectArea: false, workspaceArea: false, projectRecord: false,
      }
    },
    render,
  })
}

async function renderShared(
  name: string,
  props: Record<string, unknown> = {},
  slots: Record<string, () => VNode | VNode[]> = {},
): Promise<string> {
  if (name === 'FilterBar') return renderFilter(name, props, slots)
  const app = createSSRApp({ render: () => h(loadShared(name), props, slots) })
  app.component('NuxtLink', NuxtLinkStub)
  app.component('UButton', NuxtLinkStub)
  return renderToString(app)
}

describe('shared composition rendered contracts', () => {
  it('renders PageHeader back link, title, description, and actions in order', async () => {
    const html = await renderShared(
      'PageHeader',
      { title: 'Tasks', description: 'Track delivery', backTo: '/tasks', backLabel: 'Back' },
      {
        title: () => h('span', { 'data-slot-content': 'title' }, 'Title slot'),
        actions: () => h('button', { type: 'button' }, 'Create'),
      },
    )

    expect(html).toContain('href="/tasks"')
    expect(html).toContain('Back')
    expect(html).toContain('Title slot')
    expect(html).toContain('Track delivery')
    expect(html).toContain('Create')
    expect(html.indexOf('Back')).toBeLessThan(html.indexOf('Title slot'))
    expect(html.indexOf('Title slot')).toBeLessThan(html.indexOf('Create'))
  })

  it('renders view actions above collapsible search and controls, with active filters below', async () => {
    const html = await renderShared('FilterBar', { activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Search' }),
      default: () => h('button', { type: 'button' }, 'All states'),
      active: () => h('span', { 'data-filter': 'active' }, 'State: Done'),
      view: () => h('button', { type: 'button' }, 'Board'),
    })

    expect(html).toContain('aria-label="Search"')
    expect(html).toContain('All states')
    expect(html).toContain('State: Done')
    expect(html).toContain('Board')
    const searchMarker = html.indexOf('data-slot="search"')
    const controlsMarker = html.indexOf('data-slot="controls"')
    const viewMarker = html.indexOf('data-slot="view"')
    const activeRowMarker = html.indexOf('data-slot="active-row"')
    expect(searchMarker).toBeGreaterThanOrEqual(0)
    expect(controlsMarker).toBeGreaterThan(searchMarker)
    expect(viewMarker).toBeGreaterThanOrEqual(0)
    // Filters open as a toggled row between the toolbar and the active filters.
    expect(activeRowMarker).toBeGreaterThan(controlsMarker)
  })

  it('renders each page width as its own class, and defaults to the list band', async () => {
    // The width is a vocabulary of three named bands, not a utility a page
    // picks for itself: the class is what the stylesheet sizes.
    for (const width of ['list', 'detail', 'form'] as const) {
      const html = await renderShared('PageContainer', { width }, { default: () => h('p', 'محتوى') })
      expect(html, width).toContain(`data-layout-width="${width}"`)
      expect(html, width).toContain(`nasq-page-width-${width}`)
      expect(html, width).toContain('محتوى')
    }
    const fallback = await renderShared('PageContainer', {}, { default: () => h('p', 'محتوى') })
    expect(fallback).toContain('nasq-page-width-list')
    expect(fallback, 'a band is a class, never an inline max-width').not.toMatch(/max-w-/)
  })

  it('renders FormSection title and description with reference section spacing', async () => {
    const html = await renderShared(
      'FormSection',
      { title: 'General', description: 'Identity fields' },
      { default: () => h('input', { 'aria-label': 'Name' }) },
    )
    expect(html).toContain('<section class="space-y-5">')
    expect(html).toContain('General')
    expect(html).toContain('Identity fields')
    expect(html).toContain('aria-label="Name"')
  })

  it('renders EmptyState as status with title, description, icon, and action', async () => {
    const html = await renderShared(
      'EmptyState',
      { title: 'No tasks', description: 'Create one to get started' },
      {
        icon: () => h('svg', { 'aria-hidden': 'true' }),
        action: () => h('button', { type: 'button' }, 'Create task'),
      },
    )

    expect(html).toMatch(/role="status"/)
    expect(html).toContain('No tasks')
    expect(html).toContain('Create one to get started')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('Create task')
  })
})
