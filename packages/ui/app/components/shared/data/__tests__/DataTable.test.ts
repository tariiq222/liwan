import * as Vue from 'vue'
import { h, type VNode } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as dataTable from '../../../../utils/dataTable'
import * as errorState from '../../../../utils/errorState'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

interface Row { id: number; name: string; manager: string }
interface Column { id?: string; accessorKey?: string; header?: string; meta?: { sortable?: boolean } }
const rows: Row[] = [{ id: 1, name: 'Alpha', manager: 'Sara' }, { id: 2, name: 'Portal', manager: 'Omar' }]
const columns: Column[] = [{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'manager', header: 'Manager' }]
const slot = <P>(render: (props: P) => VNode) => render as (...args: unknown[]) => VNode

// UTable stand-in: the cell and header slot API (`<id>-cell` / `<id>-header`) the component relies on.
const TableStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { data: { type: Array, default: () => [] }, columns: { type: Array, default: () => [] }, caption: String },
  setup(props, { slots }) {
    const table = { getIsSomePageRowsSelected: () => false, getIsAllPageRowsSelected: () => false, toggleAllPageRowsSelected: () => {} }
    const id = (column: Column) => column.id ?? column.accessorKey!
    return () => h('table', [
      props.caption ? h('caption', props.caption) : null,
      h('thead', h('tr', (props.columns as Column[]).map(column => h('th', slots[`${id(column)}-header`]?.({ table, column: { columnDef: { header: column.header } } }) ?? column.header ?? '')))),
      h('tbody', (props.data as Record<string, unknown>[]).map(original => h('tr', { 'data-slot': 'tr' }, (props.columns as Column[]).map(column => {
        const row = { original, getValue: (key: string) => original[key], getIsSelected: () => false, toggleSelected: () => {} }
        return h('td', slots[`${id(column)}-cell`]?.({ row }) ?? String(original[id(column)] ?? ''))
      })))),
    ])
  },
})
const CheckboxStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: null, default: false }, disabled: Boolean },
  setup(props, { attrs }) {
    return () => h('button', { role: 'checkbox', 'aria-label': attrs['aria-label'], 'aria-checked': String(props.modelValue), disabled: props.disabled || undefined })
  },
})
const LinkStub = Vue.defineComponent({
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) { return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.()) },
})

const options = (patch: SharedRenderOptions = {}): SharedRenderOptions => ({
  modules: {
    '../../../composables/useRowNavigation': { useRowNavigation: () => {} },
    '../../../utils/dataTable': dataTable,
    '../../../utils/errorState': errorState,
  },
  globals: { navigateTo: vi.fn() },
  stubs: { UTable: TableStub, UCheckbox: CheckboxStub, NuxtLink: LinkStub, UPagination: Vue.defineComponent({ props: { ui: Object }, setup: props => () => h('nav', { 'data-ui-list': (props.ui as { list?: string } | undefined)?.list }) }) },
  ...patch,
})
const render = (props: Record<string, unknown>, slots: Record<string, (...args: unknown[]) => VNode> = {}, patch?: SharedRenderOptions) =>
  renderShared('DataTable', { rows, columns, rowKey: 'id', ...props }, slots, options(patch))

describe('SharedDataTable sorting', () => {
  const sortable: Column[] = [{ accessorKey: 'name', header: 'Name', meta: { sortable: true } }, { accessorKey: 'manager', header: 'Manager' }]

  it('renders a sortable header as a button and leaves the others plain text', async () => {
    const html = await render({ columns: sortable })
    expect(html.match(/data-slot="sort-button"/g)).toHaveLength(1)
    expect(html).toMatch(/<button[^>]*data-slot="sort-button"[^>]*data-sort="none"[^>]*>[\s\S]*Name[\s\S]*states.sortNone/)
    expect(html).toContain('<th>Manager</th>')
  })

  it('shows the active direction from `sort`, keyed through sortKeys', async () => {
    const asc = await render({ columns: sortable, sort: { column: 'project_name', direction: 'asc' }, sortKeys: { name: 'project_name' } })
    expect(asc).toContain('data-sort="asc"')
    expect(asc).toContain('i-lucide-chevron-up')
    expect(asc).toContain('states.sortAscending')
    const desc = await render({ columns: sortable, sort: { column: 'name', direction: 'desc' } })
    expect(desc).toContain('data-sort="desc"')
    expect(desc).toContain('i-lucide-chevron-down')
    const other = await render({ columns: sortable, sort: { column: 'manager', direction: 'asc' } })
    expect(other).toContain('data-sort="none"')
    expect(other).toContain('i-lucide-chevrons-up-down')
  })

  it('keeps SSR sorting disabled and renders only phone rows after narrow hydration', async () => {
    const mobile = { 'mobile-row': slot<{ row: Row }>(({ row }) => h('span', `mobile:${row.name}`)) }
    const server = await render({ columns: sortable }, mobile, { hydrated: false, ssrWidth: 390 })
    expect(server).toMatch(/data-slot="sort-button"[^>]*disabled/)
    expect(server).toContain('<table')
    expect(server).toContain('mobile:Portal')
    expect(server).toContain('hidden md:block')
    expect(server).toContain('md:hidden')
    const phone = await render({ columns: sortable }, mobile, { hydrated: true, ssrWidth: 390 })
    expect(phone).not.toContain('<table')
    expect(phone).not.toContain('sort-button')
    expect(phone).toContain('mobile:Portal')
    expect(phone.match(/<li[^>]*data-shortcut-row[^>]*>/g)).toHaveLength(2)
    expect(phone).toMatch(/<li[^>]*data-row-index="1"[^>]*tabindex="-1"/)
  })
})

describe('sort helpers', () => {
  it('cycles ascending, descending, none', () => {
    expect(dataTable.nextSortDirection(null)).toBe('asc')
    expect(dataTable.nextSortDirection('asc')).toBe('desc')
    expect(dataTable.nextSortDirection('desc')).toBeNull()
  })

  it('sets aria-sort per header cell and none on unsortable ones', () => {
    const cells = [0, 1, 2].map(() => { const attrs: Record<string, string> = {}; return { attrs, setAttribute: (k: string, v: string) => { attrs[k] = v }, removeAttribute: (k: string) => { delete attrs[k] } } })
    cells[2]!.attrs['aria-sort'] = 'stale'
    dataTable.markSortHeaders({ querySelectorAll: () => cells } as unknown as ParentNode, ['asc', null, undefined])
    expect(cells.map(cell => cell.attrs['aria-sort'])).toEqual(['ascending', 'none', undefined])
  })
})

describe('SharedDataTable', () => {
  it('renders filters, CSS-selected server layouts and pagination before client pruning', async () => {
    const html = await render({ page: 1, pages: 3, caption: 'Projects' }, {
      filters: () => h('input', { 'aria-label': 'Search' }),
      'mobile-row': slot<{ row: Row }>(({ row }) => h('span', `mobile:${row.name}`)),
    }, { hydrated: false })
    expect(html).toContain('data-slot="data-table-filters"')
    expect(html).toContain('<caption>Projects</caption>')
    expect(html).toContain('hidden md:block')
    expect(html).toContain('md:hidden')
    expect(html.match(/<tr data-slot="tr">/g)).toHaveLength(2)
    expect(html.match(/<li[^>]*data-shortcut-row[^>]*>/g)).toHaveLength(2)
    expect(html).toContain('mobile:Portal')
    expect(html).toContain('data-testid="shared-pagination"')
    // Page buttons wrap so pagination never widens a 390px page.
    expect(html).toMatch(/data-ui-list="[^"]*flex-wrap/)
  })

  it('draws its own card unless bare, and shows the footer under the table', async () => {
    const own = await render({}, { footer: () => h('span', 'Of 2 results') })
    expect(own).toContain('rounded-card')
    expect(own).toContain('data-slot="data-table-footer"')
    expect(own.indexOf('<table')).toBeLessThan(own.indexOf('Of 2 results'))
    const bare = await render({ bare: true }, { footer: () => h('span', 'Of 2 results') })
    expect(bare).not.toContain('rounded-card')
    expect(bare).toContain('data-slot="data-table-footer"')
  })

  it('shows no footer when the table is empty', async () => {
    const html = await render({ bare: true, rows: [] }, { footer: () => h('span', 'Of 0 results') })
    expect(html).not.toContain('data-slot="data-table-footer"')
  })

  it('shows the table on every width when there is no mobile row slot', async () => {
    const html = await render({})
    expect(html).not.toContain('hidden md:block')
    expect(html).not.toContain('<li')
  })

  it('links the first column to rowTo unless the caller renders that cell', async () => {
    const linked = await render({ rowTo: (row: Row) => `/projects/${row.id}` })
    expect(linked).toMatch(/<a href="\/projects\/2"[^>]*>Portal<\/a>/)
    const custom = await render({ rowTo: (row: Row) => `/projects/${row.id}` }, {
      'name-cell': slot<{ row: { original: Row } }>(({ row }) => h('strong', `custom:${row.original.name}`)),
    })
    expect(custom).toContain('custom:Portal')
    expect(custom).not.toContain('href="/projects/2"')
  })

  it('does not inject the link into a first column without an accessor or with its own cell renderer', async () => {
    const rowTo = (row: Row) => `/projects/${row.id}`
    const noAccessor = await render({ rowTo, columns: [{ id: 'actions', header: 'Actions' }, ...columns] })
    expect(noAccessor).not.toContain('href=')
    const ownCell = await render({ rowTo, columns: [{ accessorKey: 'name', header: 'Name', cell: () => 'x' }] })
    expect(ownCell).not.toContain('href=')
  })

  it('shows the bulk bar only while rows are selected', async () => {
    const bulk = { bulk: slot<{ selected: (string | number)[] }>(({ selected }) => h('span', `bulk:${selected.join(',')}`)) }
    const selected = await render({ selectable: true, selected: [2] }, bulk)
    expect(selected).toContain('role="toolbar"')
    expect(selected).toContain('aria-label="states.bulkActions"')
    expect(selected).toContain('states.selectedCount')
    expect(selected).toContain('bulk:2')
    expect(selected).toContain('states.clearSelection')
    expect(await render({ selectable: true, selected: [] }, bulk)).not.toContain('role="toolbar"')
  })

  it('adds a select column whose checkboxes are labelled and wait for hydration', async () => {
    const html = await render({ selectable: true }, {}, { hydrated: false })
    expect(html).toMatch(/<button role="checkbox" aria-label="states.selectAll"[^>]*disabled/)
    expect(html.match(/aria-label="states.selectRow"/g)).toHaveLength(2)
  })

  it('hands loading, errors and empty lists to the shared states and keeps the filters', async () => {
    const filters = { filters: () => h('input', { 'aria-label': 'Search' }) }
    const loading = await render({ loading: true, rows: [] }, filters)
    expect(loading).toContain('data-slot="loading-skeleton"')
    expect(loading).toContain('aria-label="Search"')
    expect(await render({ error: { status: 403 } })).toContain('data-slot="forbidden-state"')
    expect(await render({ rows: [], emptyText: 'No projects yet' })).toContain('No projects yet')
  })
})

describe('SharedDataTable layout', () => {
  it('wraps the table in a container frame that stacks by default and carries the layout flags', async () => {
    const html = await render({ selectable: true, columns: [...columns, { id: 'actions', header: 'Actions' }] })
    expect(html).toMatch(/<div[^>]*data-slot="data-table-frame"[^>]*class="liwan-table-frame"[^>]*data-stack="true"[^>]*data-selectable="true"[^>]*data-has-actions="true"/)
  })

  it('opts out of stacking and leaves the other flags off', async () => {
    const html = await render({ stack: false })
    expect(html).toContain('data-slot="data-table-frame"')
    expect(html).not.toContain('data-stack')
    expect(html).not.toContain('data-has-actions')
    expect(html).not.toContain('data-selectable')
  })

  it('decorates columns for the layout: sticky first column, labelled cells, sticky actions', async () => {
    let seen: Column[] = []
    const Spy = Vue.defineComponent({ props: { columns: { type: Array, default: () => [] } }, setup(props) { return () => { seen = props.columns as Column[]; return h('table') } } })
    await render({ columns: [...columns, { id: 'actions', header: 'Actions' }] }, {}, { stubs: { UTable: Spy } })
    const classes = seen.map(column => (column as { meta?: { class?: { td?: string } } }).meta?.class?.td)
    expect(classes[0]).toContain('liwan-sticky-start')
    expect(classes[1]).toBeUndefined()
    expect(classes[2]).toContain('liwan-sticky-end')
    expect((seen[1] as { meta: { style: { td: unknown } } }).meta.style.td).toEqual({ '--liwan-label': '"Manager"' })
  })
})

