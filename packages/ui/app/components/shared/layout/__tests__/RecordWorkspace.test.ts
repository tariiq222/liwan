import * as Vue from 'vue'
import { h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as errorState from '../../../../utils/errorState'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const options: SharedRenderOptions = {
  modules: { '../../../utils/errorState': errorState },
  globals: {
    useRoute: () => ({ path: '/projects/1/tasks/5', query: {} }),
    usePageArea: () => () => ({ plain: false, record: false }),
    usePageHeader: () => undefined,
    useEscapeBack: () => undefined,
    useFrameOwnsHeading: () => Vue.ref(false),
  },
}
const trail = [
  { label: 'Projects', to: '/projects' },
  { label: 'Alpha', to: '/projects/1' },
  { label: 'Tasks', to: '/projects/1/tasks', testId: 'record-list-crumb' },
  { label: 'Write the brief' },
]
const slots = {
  status: () => h('button', 'In progress'),
  meta: () => h('span', 'META'),
  actions: () => h('button', 'MENU'),
  main: () => h('p', 'MAIN'),
  aside: () => h('p', 'PROPERTIES'),
}
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedRecordWorkspace', () => {
  it('draws the whole trail, ending with the record as plain text, and one heading', async () => {
    const html = clean(await renderShared('RecordWorkspace', { title: 'Write the brief', trail, backTo: '/projects/1/tasks' }, slots, options))
    expect(html).toContain('data-template="record-workspace"')
    for (const step of ['Projects', 'Alpha', 'Tasks']) expect(html).toMatch(new RegExp(`<a[^>]*>${step}</a>`))
    expect(html).toContain('data-testid="record-list-crumb"')
    expect(html).toMatch(/<span class="text-dimmed">Write the brief<\/span>/)
    expect(html.match(/<h1/g)).toHaveLength(1)
  })

  it('has no tabs, no app tile and no tagline', async () => {
    const html = clean(await renderShared('RecordWorkspace', { title: 'Write the brief', trail }, slots, {
      ...options,
      globals: { ...options.globals, usePageApp: () => Vue.ref({ icon: 'i-lucide-folder', id: 'projects', tagline: 'One place for projects' }) },
    }))
    expect(html).not.toContain('page-header-tabs')
    expect(html).not.toContain('page-header-chip')
    expect(html).not.toContain('page-header-tagline')
    expect(html).not.toContain('One place for projects')
  })

  it('puts the status and meta after the title and the actions on the same row, then the aside before the main column in the DOM', async () => {
    const html = clean(await renderShared('RecordWorkspace', { title: 'Write the brief', trail }, slots, options))
    const row = html.slice(html.indexOf('data-slot="page-header-row"'), html.indexOf('data-slot="record-body"'))
    expect(row.indexOf('Write the brief')).toBeLessThan(row.indexOf('In progress'))
    expect(row.indexOf('In progress')).toBeLessThan(row.indexOf('META'))
    expect(row.indexOf('META')).toBeLessThan(row.indexOf('MENU'))
    expect(html.indexOf('PROPERTIES')).toBeLessThan(html.indexOf('MAIN'))
    expect(html).toMatch(/<aside[^>]*aria-label="states.properties"/)
    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]')
  })

  it('gives the main column the full width without an aside', async () => {
    const html = clean(await renderShared('RecordWorkspace', { title: 'Write the brief', trail }, { main: slots.main }, options))
    expect(html).not.toContain('<aside')
    expect(html).not.toContain('lg:grid-cols-')
  })

  it('replaces the trail with the breadcrumb slot', async () => {
    const html = clean(await renderShared('RecordWorkspace', { title: 'Write the brief', trail }, { ...slots, breadcrumb: () => h('span', 'CUSTOM TRAIL') }, options))
    expect(html).toContain('CUSTOM TRAIL')
    expect(html).not.toContain('>Alpha<')
  })

  it('shows the record skeleton while loading, without status, actions, main or aside', async () => {
    const html = clean(await renderShared('RecordWorkspace', { title: '', trail: [], loading: true }, slots, options))
    expect(html).toContain('data-variant="record"')
    for (const hidden of ['In progress', 'MENU', 'MAIN', 'PROPERTIES']) expect(html).not.toContain(hidden)
  })

  it('hands errors to the shared states and keeps Escape on the list', async () => {
    const useEscapeBack = vi.fn()
    const missing = clean(await renderShared('RecordWorkspace', { title: 'Alpha', trail, error: { status: 404 }, backTo: '/projects/1/tasks' }, slots, { ...options, globals: { ...options.globals, useEscapeBack } }))
    expect(missing).toContain('data-slot="not-found-state"')
    expect(useEscapeBack.mock.calls[0]![0]()).toBe('/projects/1/tasks')
  })
})
