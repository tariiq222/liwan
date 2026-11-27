import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as settingsListName from '@liwan/ui/app/utils/settingsListName'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ChangeCategory } from '@liwan/contracts'
import { DEFAULT_STUBS, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { ApiError } from '../../../../../composables/useApi'

const FILE = resolve(import.meta.dirname, '../ChangeCategoriesPanel.vue')
const source = readFileSync(FILE, 'utf8')
// SharedSettingsListRow compiles against its sibling utils module; the harness needs it by its specifier.
const NAME_MODULES = { '../../../utils/settingsListName': settingsListName }

const category = (over: Partial<ChangeCategory> = {}): ChangeCategory => ({ id: 1, name: 'تصميم', sequence: 10, active: true, ...over })

const toastAdd = vi.fn()

type Load = { panel: Vue.Component; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; refetch: ReturnType<typeof vi.fn>; changeQuery: ReturnType<typeof vi.fn> }
function load(rows: ChangeCategory[], options: { error?: unknown } = {}): Load {
  const create = vi.fn(async () => category({ id: 99, name: 'جديد' }))
  const update = vi.fn(async () => rows[0] ?? category())
  const refetch = vi.fn()
  const changeQuery = vi.fn(() => ({ data: Vue.ref({ items: rows, total: rows.length }), error: Vue.ref(options.error ?? null), refetch }))
  const panel = loadShared(FILE, {
    modules: {
      '@/composables/useApi': { ApiError },
      '@/composables/useProjectChanges': {
        useChangeCategories: changeQuery,
        useCreateChangeCategory: () => ({ mutateAsync: create, isPending: Vue.ref(false) }),
        useUpdateChangeCategory: () => ({ mutateAsync: update, isPending: Vue.ref(false) }),
      },
    },
    globals: { useToast: () => ({ add: toastAdd }) },
  })
  return { panel, create, update, refetch, changeQuery }
}

const recordSection = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('section', attrs, [slots.actions?.(), slots.default?.()]) } })
// The panel hands a load failure to SharedPageState; the stub hides the rows and offers the retry the panel wired.
const pageState = Vue.defineComponent({
  inheritAttrs: false,
  props: { loading: Boolean, error: { type: null, default: undefined } },
  setup(props, { attrs, slots }) {
    return () => props.loading || props.error
      ? Vue.h('div', attrs, [Vue.h('button', { 'data-retry': '', onClick: () => (attrs.onRetry as () => void)?.() })])
      : slots.default?.()
  },
})
const input = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs }) { return () => Vue.h('input', attrs) } })
const stubs: Record<string, Vue.Component> = {
  ...DEFAULT_STUBS,
  UInput: input,
  SharedRecordSection: recordSection,
  SharedPageState: pageState,
  SharedSettingsList: loadShared('SettingsList', { modules: NAME_MODULES }),
  SharedSettingsListRow: loadShared('SettingsListRow', { modules: NAME_MODULES }),
}

function withComponents(app: Vue.App) {
  for (const [name, stub] of Object.entries(stubs)) app.component(name, stub)
  return app
}

async function render(props: Record<string, unknown>, rows: ChangeCategory[], options: { error?: unknown } = {}) {
  const { panel } = load(rows, options)
  return renderToString(withComponents(Vue.createSSRApp({ render: () => Vue.h(panel, props) })))
}

type Node = { type: string; props: Record<string, any>; children: Node[]; parent: Node | null; text?: string }
const node = (type = 'root'): Node => ({ type, props: {}, children: [], parent: null })
const hostConfig = {
  patchProp: (el: Node, key: string, _old: unknown, value: unknown) => { el.props[key] = value },
  insert(el: Node, parent: Node) { el.parent = parent; parent.children.push(el) },
  remove(el: Node) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1) },
  createElement: node, createText: (text: string) => ({ ...node('text'), text }), createComment: (text: string) => ({ ...node('comment'), text }),
  setText: (el: Node, text: string) => { el.text = text }, setElementText: (el: Node, text: string) => { el.text = text; el.children = [] },
  parentNode: (el: Node) => el.parent, nextSibling: (el: Node) => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
}

function interact(props: Record<string, unknown>, rows: ChangeCategory[], options: { error?: unknown } = {}) {
  // A failed rename re-keys its row, so Vue unmounts the stale <li> and mounts a fresh one holding the stored name.
  let removedRows = 0
  const tree = Vue.createRenderer<Node, Node>({
    ...hostConfig,
    remove(el: Node) { if (el.type === 'li') removedRows += 1; if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1) },
  })
  const { panel, create, update, refetch, changeQuery } = load(rows, options)
  const app = tree.createApp({ render: () => Vue.h(panel, props) })
  withComponents(app)
  const root = node(); app.mount(root)
  const find = (match: (el: Node) => boolean, el: Node = root): Node | undefined => match(el) ? el : el.children.map(child => find(match, child)).find(Boolean)
  const byTestId = (id: string) => find(el => el.props['data-testid'] === id)!
  const within = (parent: Node, match: (el: Node) => boolean) => parent.children.map(child => find(match, child)).find(Boolean)!
  const settle = async () => { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }
  return { app, create, update, refetch, changeQuery, find, byTestId, within, settle, removedRows: () => removedRows, unmount: () => app.unmount() }
}

describe('ChangeCategoriesPanel structure', () => {
  it('renders on SharedSettingsList/SharedSettingsListRow with the stable anchor and per-row test ids', () => {
    expect(source).toContain('<SharedSettingsList')
    expect(source).toContain('<SharedSettingsListRow')
    expect(source).toContain('id="project-change-categories"')
    expect(source).toContain('data-testid="change-categories"')
    expect(source).toContain(':data-testid="`change-category-${category.id}`"')
    expect(source).toContain('data-testid="change-category-new"')
    expect(source).toContain(':key="`${category.id}-${resetGeneration}`"')
    // The manual list, inline edit form and its state are gone with the shared row.
    expect(source).not.toContain('<ul')
    expect(source).not.toContain('<form')
    expect(source).not.toContain('editingId')
  })

  it('keeps the archived query, the load-error retry and the save toast wiring', () => {
    expect(source).toContain('useChangeCategories(true)')
    expect(source).toContain('@retry="categories.refetch"')
    expect(source).toContain(':error="categories.error.value"')
    expect(source).toContain("sequence: (items.value.length + 1) * 10")
  })
})

describe('ChangeCategoriesPanel rendering', () => {
  it('draws every category on the shared list with its badges and archive/restore buttons', async () => {
    const html = await render({ canEdit: true }, [category(), category({ id: 2, name: 'تنفيذ', sequence: 20, active: false })])
    expect(html).toContain('data-slot="settings-list"')
    expect(html).toContain('id="project-change-categories"')
    expect(html).toContain('data-testid="change-categories"')
    expect(html).toContain('data-testid="change-category-1"')
    expect(html).toContain('data-testid="change-category-2"')
    expect(html).toContain('label="app.list.archive"')
    expect(html).toContain('label="app.list.restore"')
    expect(html).toContain('app.list.archived')
    expect(html).toContain('data-testid="change-category-new"')
  })

  it('draws an empty list message when no category exists yet', async () => {
    const html = await render({ canEdit: true }, [])
    expect(html).toContain('app.list.empty')
    expect(html).toContain('data-testid="change-category-new"')
  })

  it('shows a viewer the rows disabled with a view-only badge and no add form', async () => {
    const html = await render({ canEdit: false }, [category()])
    expect(html).toContain('app.viewOnly')
    expect(html).not.toContain('data-testid="change-category-new"')
    expect(html).not.toContain('label="app.list.archive"')
    expect(html).toContain('disabled')
  })

  it('replaces the rows with the load-error state and retries the query', async () => {
    const html = await render({ canEdit: true }, [], { error: new ApiError(0, 'network', 'down') })
    expect(html).not.toContain('data-testid="change-category-1"')
    expect(html).not.toContain('data-testid="change-category-new"')

    const h = interact({ canEdit: true }, [], { error: new Error('down') })
    h.find(el => 'data-retry' in el.props)!.props.onClick()
    await h.settle()
    expect(h.refetch).toHaveBeenCalledOnce()
    h.unmount()
  })
})

describe('ChangeCategoriesPanel behaviour', () => {
  const rows = [category(), category({ id: 2, name: 'تنفيذ', sequence: 20, active: false })]

  it('adds from the add form with the next sequence, clears the input only on success and toasts', async () => {
    const h = interact({ canEdit: true }, rows)
    const form = h.find(el => el.type === 'form')!
    const newInput = h.byTestId('change-category-new')
    const addButton = form.children.find(child => child.type === 'button')!

    // Nothing to add yet: the submit stays disabled and the submit is ignored.
    expect(addButton.props.disabled).toBe(true)
    form.props.onSubmit({ preventDefault() {} })
    await h.settle()
    expect(h.create).not.toHaveBeenCalled()

    newInput.props['onUpdate:modelValue']('  تشطيب  ')
    await h.settle()
    expect(addButton.props.disabled).toBe(false)
    form.props.onSubmit({ preventDefault() {} })
    await h.settle()
    expect(h.create).toHaveBeenCalledWith({ name: 'تشطيب', sequence: 30 })
    expect(toastAdd).toHaveBeenCalledWith({ title: 'settings.projects.changeCategories.added', color: 'success' })
    expect(h.byTestId('change-category-new').props.modelValue).toBe('')
    h.unmount()
  })

  it('keeps the typed name and shows the failure in the card when the add is refused', async () => {
    const h = interact({ canEdit: true }, rows, )
    h.create.mockRejectedValueOnce(new ApiError(422, 'invalid', 'duplicate'))
    const form = h.find(el => el.type === 'form')!
    h.byTestId('change-category-new').props['onUpdate:modelValue']('مكرر')
    await h.settle()
    form.props.onSubmit({ preventDefault() {} })
    await h.settle()
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.find(el => el.type === 'p' && el.text === 'app.saveFailed')).toBeDefined()
    expect(h.byTestId('change-category-new').props.modelValue).toBe('مكرر')
    h.unmount()
  })

  it('renames in place through the row input and toasts the save', async () => {
    const h = interact({ canEdit: true }, rows)
    const rowInput = h.within(h.byTestId('change-category-1'), el => el.type === 'input')
    rowInput.props.onChange({ target: { value: 'هندسة' } })
    await h.settle()
    expect(h.update).toHaveBeenCalledWith({ id: 1, body: { name: 'هندسة' } })
    expect(toastAdd).toHaveBeenCalledWith({ title: 'settings.projects.changeCategories.renamed', color: 'success' })
    expect(h.removedRows()).toBe(0)
    h.unmount()
  })

  it('re-keys the row after a refused rename so the stored name comes back', async () => {
    const h = interact({ canEdit: true }, rows)
    h.update.mockRejectedValueOnce(new ApiError(422, 'invalid', 'duplicate'))
    const rowInput = h.within(h.byTestId('change-category-1'), el => el.type === 'input')
    rowInput.props.onChange({ target: { value: 'مكرر' } })
    await h.settle()
    expect(h.update).toHaveBeenCalledTimes(1)
    // Every row remounts from its re-keyed <li>, and each shows the server-held name again.
    expect(h.removedRows()).toBe(rows.length)
    expect(h.within(h.byTestId('change-category-1'), el => el.type === 'input').props['model-value']).toBe('تصميم')
    expect(h.find(el => el.type === 'p' && el.text === 'app.saveFailed')).toBeDefined()

    // A successful rename on the fresh row afterwards does not re-key the rows again.
    const freshInput = h.within(h.byTestId('change-category-1'), el => el.type === 'input')
    freshInput.props.onChange({ target: { value: 'هندسة' } })
    await h.settle()
    expect(h.update).toHaveBeenLastCalledWith({ id: 1, body: { name: 'هندسة' } })
    expect(h.removedRows()).toBe(rows.length)
    h.unmount()
  })

  it('archives an active category and restores an archived one through the row button', async () => {
    const h = interact({ canEdit: true }, rows)
    h.within(h.byTestId('change-category-1'), el => el.props.label === 'app.list.archive').props.onClick()
    await h.settle()
    expect(h.update).toHaveBeenCalledWith({ id: 1, body: { active: false } })
    expect(toastAdd).toHaveBeenCalledWith({ title: 'settings.projects.changeCategories.archived', color: 'success' })

    h.within(h.byTestId('change-category-2'), el => el.props.label === 'app.list.restore').props.onClick()
    await h.settle()
    expect(h.update).toHaveBeenCalledWith({ id: 2, body: { active: true } })
    expect(toastAdd).toHaveBeenCalledWith({ title: 'settings.projects.changeCategories.restored', color: 'success' })
    h.unmount()
  })

  it('queries the archived categories and locks every control before hydration', async () => {
    const h = interact({ canEdit: true }, rows)
    expect(h.changeQuery).toHaveBeenCalledWith(true)
    h.unmount()
  })
})

describe('ChangeCategoriesPanel locale keys', () => {
  const localeKeys = (locale: 'ar' | 'en') => {
    const file = resolve(import.meta.dirname, '../../../../../../i18n/locales', locale, 'settings.json')
    const json = JSON.parse(readFileSync(file, 'utf8')) as { settings: { projects: { changeCategories: Record<string, string> } } }
    return Object.keys(json.settings.projects.changeCategories).sort()
  }

  it('keeps the ar/en changeCategories keys in 1:1 parity with none orphaned', () => {
    const ar = localeKeys('ar')
    const en = localeKeys('en')
    expect(ar).toEqual(en)
    expect(ar).toEqual(['added', 'archived', 'hint', 'name', 'renamed', 'restored', 'title'])
    for (const key of ar) expect(source, key).toContain(`settings.projects.changeCategories.${key}`)
  })
})
