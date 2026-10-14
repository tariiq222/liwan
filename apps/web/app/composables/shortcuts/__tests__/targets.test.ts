import { describe, expect, it, vi } from 'vitest'
import { sidebarModel } from '../../nav/sidebarModel'
import { clickPageCreate, createShortcutTarget, focusListSearch } from '../targets'

interface Double { tag: string; visible: boolean; disabled: boolean; ariaDisabled: boolean; children: Double[] }
function make(tag: string, patch: Partial<Double> = {}) {
  const node = { tag, visible: true, disabled: false, ariaDisabled: false, children: [] as Double[], focus: vi.fn(), select: vi.fn(), click: vi.fn(), ...patch }
  const tags = (selectors: string) => selectors.split(',').map(selector => selector.trim())
  return Object.assign(node, {
    matches: (selectors: string) => tags(selectors).includes(node.tag),
    querySelector: (selectors: string) => node.children.find(child => tags(selectors).includes(child.tag)) ?? null,
    getClientRects: () => (node.visible ? [{}] : []),
    getAttribute: (name: string) => (name === 'aria-disabled' && node.ariaDisabled ? 'true' : null),
  })
}
const root = (...marked: unknown[]) => ({ querySelectorAll: () => marked }) as unknown as ParentNode

describe('focusListSearch', () => {
  it('focuses and selects a marked input', () => {
    const input = make('input')
    expect(focusListSearch(root(input))).toBe(true)
    expect(input.focus).toHaveBeenCalled()
    expect(input.select).toHaveBeenCalled()
  })

  it('focuses the input inside a marked wrapper', () => {
    const input = make('input')
    expect(focusListSearch(root(make('div', { children: [input] })))).toBe(true)
    expect(input.focus).toHaveBeenCalled()
  })

  it('skips hidden and disabled fields and reports when nothing is usable', () => {
    const hidden = make('input', { visible: false })
    const disabled = make('input', { disabled: true })
    expect(focusListSearch(root(hidden, disabled, make('div')))).toBe(false)
    expect(hidden.focus).not.toHaveBeenCalled()
    expect(disabled.focus).not.toHaveBeenCalled()
  })
})

describe('clickPageCreate', () => {
  it('presses the first usable marked control', () => {
    const blocked = make('button', { ariaDisabled: true })
    const create = make('a')
    expect(clickPageCreate(root(blocked, create))).toBe(true)
    expect(blocked.click).not.toHaveBeenCalled()
    expect(create.click).toHaveBeenCalled()
  })

  it('reports when the page marked none', () => {
    expect(clickPageCreate(root())).toBe(false)
  })
})

describe('createShortcutTarget', () => {
  const links = [
    { id: 'new-project', labelKey: 'x', icon: {}, to: '/projects/new', pinned: true },
    { id: 'tasks', labelKey: 'y', icon: {}, to: '/tasks' },
  ] as never
  const model = (path: string) => sidebarModel({ links, moduleLabelKey: null, path, panel: null, surface: 'desktop' }).createLinks
  const resolve = (link: { to: unknown }) => ({ path: link.to as string, query: { returnTo: '/x' } })

  it('picks the first create link the sidebar shows', () => {
    expect(createShortcutTarget(model('/tasks'), resolve, '/tasks')).toEqual({ path: '/projects/new', query: { returnTo: '/x' } })
  })

  it.each(['/projects', '/projects/new', '/projects/7', '/projects/7/tasks/3'])('is null on %s, where the sidebar hides the create', (path) => {
    expect(createShortcutTarget(model(path), resolve, path)).toBeNull()
  })

  it('is null when the target is the open page', () => {
    expect(createShortcutTarget([{ id: 'n', to: '/tasks/new' }], link => link.to as string, '/tasks/new')).toBeNull()
    expect(createShortcutTarget([{ id: 'n', to: '/tasks/new' }], () => '/tasks/new?returnTo=%2Ftasks', '/tasks/new')).toBeNull()
  })

  it('is null when a desktop panel replaces the create links', () => {
    const panelled = sidebarModel({ links, moduleLabelKey: null, path: '/tasks', panel: { expanded: false }, surface: 'desktop' }).createLinks
    expect(createShortcutTarget(panelled, resolve, '/tasks')).toBeNull()
  })
})
