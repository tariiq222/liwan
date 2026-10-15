import * as Vue from 'vue'
import { h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as errorState from '../../../../utils/errorState'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const options: SharedRenderOptions = {
  modules: { '../../../utils/errorState': errorState },
  globals: {
    useRoute: () => ({ path: '/projects/1', query: {} }),
    usePlainRoute: () => () => false,
    usePageHeader: () => undefined,
    useEscapeBack: () => undefined,
    useProjectFrameHeading: () => Vue.ref(false),
  },
}
// SSR marks slot and fragment boundaries with comments; the assertions read the markup without them.
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')
const record = {
  actions: () => h('button', 'Edit'),
  tabs: () => h('nav', { 'aria-label': 'Sections' }, 'TABS'),
  default: () => h('p', 'MAIN'),
  aside: () => h('p', 'PROPERTIES'),
}

describe('SharedRecordPage', () => {
  it('renders the header, tabs, main column and properties aside in reading order', async () => {
    const html = await renderShared('RecordPage', { title: 'Alpha', backTo: '/projects', backLabel: 'Projects' }, record, options)
    expect(clean(html)).toMatch(/<h1[^>]*>Alpha<\/h1>/)
    expect(html).toContain('href="/projects"')
    expect(html).toContain('Edit')
    expect(html).toContain('data-slot="record-tabs"')
    expect(html).toMatch(/<aside[^>]*aria-label="states.properties"/)
    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]')
    expect(html.indexOf('TABS')).toBeLessThan(html.indexOf('MAIN'))
    expect(html.indexOf('MAIN')).toBeLessThan(html.indexOf('PROPERTIES'))
  })

  it('gives the main column the full width when there is no aside', async () => {
    const html = await renderShared('RecordPage', { title: 'Alpha' }, { default: () => h('p', 'MAIN') }, options)
    expect(html).not.toContain('<aside')
    expect(html).not.toContain('lg:grid-cols-')
  })

  it('shows the record skeleton while loading, with no actions, tabs or aside, and a heading placeholder', async () => {
    const html = await renderShared('RecordPage', { title: '', loading: true }, record, options)
    expect(html).toContain('data-variant="record"')
    for (const hidden of ['Edit', 'TABS', 'MAIN', 'PROPERTIES']) expect(html).not.toContain(hidden)
    expect(html).toMatch(/<h1[^>]*>.*app\.loading.*<\/h1>/s)
  })

  it('hands errors to the shared states', async () => {
    expect(await renderShared('RecordPage', { title: 'Alpha', error: { status: 404 } }, record, options)).toContain('data-slot="not-found-state"')
    const failed = await renderShared('RecordPage', { title: 'Alpha', error: { status: 500 } }, record, options)
    expect(failed).toContain('data-slot="error-state"')
    expect(failed).not.toContain('MAIN')
  })

  it('keeps Escape registered to backTo when the custom back slot replaces the control', async () => {
    const useEscapeBack = vi.fn()
    await renderShared('RecordPage', { title: 'مهمة', backTo: '/tasks?q=خطة' }, {
      back: () => h('a', { href: '/tasks?q=خطة' }, 'رجوع'),
    }, { ...options, globals: { ...options.globals, useEscapeBack } })
    expect(useEscapeBack).toHaveBeenCalledTimes(1)
    expect(useEscapeBack.mock.calls[0]![0]()).toBe('/tasks?q=خطة')
  })

  it('forwards the back slot to the header in place of the default back button', async () => {
    const html = await renderShared('RecordPage', { title: 'مهمة', backTo: '/tasks' }, {
      back: () => h('a', { 'data-testid': 'task-detail-back', href: '/tasks' }, 'رجوع'),
      default: () => h('p', 'MAIN'),
    }, options)
    expect(html).toContain('data-testid="task-detail-back"')
    expect(html).not.toContain('app.back')
  })
})

describe('SharedPropertiesPanel and SharedPropertyRow', () => {
  it('renders a titled description list', async () => {
    const html = await renderShared('PropertiesPanel', { title: 'Properties' }, { default: () => h('div', 'ROW') })
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)"[^>]*>.*<h2 id="\1"[^>]*>Properties<\/h2>/s)
    expect(html).toMatch(/<dl[^>]*>.*ROW.*<\/dl>/s)
  })

  it('shows the value, keeps zero, and speaks an empty value instead of a dash', async () => {
    expect(clean(await renderShared('PropertyRow', { label: 'Manager', value: 'Sara' }))).toMatch(/<dt[^>]*>Manager<\/dt><dd[^>]*>Sara<\/dd>/)
    expect(clean(await renderShared('PropertyRow', { label: 'Tasks', value: 0 }))).toMatch(/<dd[^>]*>0<\/dd>/)
    for (const value of [null, undefined, '', '  ']) {
      const html = clean(await renderShared('PropertyRow', { label: 'End date', value }))
      expect(html).toContain('<span aria-hidden="true">—</span><span class="sr-only">states.noValue</span>')
    }
  })

  it('lets the default slot replace the value', async () => {
    const html = await renderShared('PropertyRow', { label: 'Status' }, { default: () => h('span', 'On track') })
    expect(html).toContain('On track')
    expect(html).not.toContain('states.noValue')
  })
})

describe('SharedRecordSection', () => {
  it('names the section by its heading and keeps the actions beside it', async () => {
    const html = await renderShared('RecordSection', { title: 'Milestones', description: 'Dates that matter', id: 'milestones' }, {
      default: () => h('p', 'BODY'),
      actions: () => h('button', 'Add'),
    })
    expect(html).toMatch(/<section[^>]*id="milestones"[^>]*aria-labelledby="milestones-title"/)
    expect(html).toMatch(/<h2 id="milestones-title"[^>]*>Milestones<\/h2>/)
    expect(html).toContain('Dates that matter')
    expect(html.indexOf('Add')).toBeLessThan(html.indexOf('BODY'))
  })

  it('makes its own heading id when none is given', async () => {
    const html = await renderShared('RecordSection', { title: 'Notes' })
    const [, id] = html.match(/aria-labelledby="([^"]+)"/) ?? []
    expect(id).toBeTruthy()
    expect(html).toContain(`<h2 id="${id}"`)
  })
})

describe('SharedRecordPage blank title and hideHeader', () => {
  it('names a record without a name «untitled» once it has loaded', async () => {
    for (const title of ['', '   ']) {
      const html = await renderShared('RecordPage', { title }, record, options)
      expect(clean(html), JSON.stringify(title)).toMatch(/<h1[^>]*>states\.untitled<\/h1>/)
    }
  })

  it('keeps the fallback away from a record that is loading or failed', async () => {
    expect(await renderShared('RecordPage', { title: '', loading: true }, record, options)).not.toContain('states.untitled')
    expect(await renderShared('RecordPage', { title: '', error: { status: 500 } }, record, options)).not.toContain('states.untitled')
  })

  it('hideHeader draws no heading, and keeps actions, tabs, body and aside', async () => {
    const html = clean(await renderShared('RecordPage', { title: 'Alpha', hideHeader: true }, record, options))
    expect(html).not.toMatch(/<h[12]/)
    for (const kept of ['Edit', 'TABS', 'MAIN', 'PROPERTIES']) expect(html).toContain(kept)
  })

  it('hideHeader with no actions draws no page header at all', async () => {
    const html = clean(await renderShared('RecordPage', { title: 'Alpha', hideHeader: true }, { default: () => h('p', 'MAIN') }, options))
    expect(html).not.toContain('data-slot="page-header"')
    expect(html).toContain('MAIN')
  })
})
