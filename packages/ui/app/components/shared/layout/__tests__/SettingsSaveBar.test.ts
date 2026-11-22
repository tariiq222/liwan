import { defineComponent, h, nextTick, reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as settingsSave from '../../../../composables/useSettingsSave'
import type { SettingsSaveEntry } from '../../../../composables/useSettingsSave'
import { DEFAULT_STUBS, loadShared } from '../../../../../test/helpers/renderShared'
import { createHostNode, findNode, hostRenderer, type HostNode } from '../../../../../test/helpers/hostRenderer'

// The component imports the composable by its own specifier, so the test hands it the same module instance the page
// root provides from: that is what makes provide/inject meet.
const modules = { '../../../composables/useSettingsSave': settingsSave }
const messages = { 'app.unsavedCount': 'Unsaved changes: {n}' }
const Bar = loadShared('SettingsSaveBar', { modules, messages })
const BarBeforeHydration = loadShared('SettingsSaveBar', { modules, messages, hydrated: false })

function entry(patch: Partial<SettingsSaveEntry> = {}): SettingsSaveEntry {
  return reactive({ id: 'card', dirty: true, saving: false, conflict: false, failed: false, submit: vi.fn(async () => undefined), revert: vi.fn(), ...patch })
}

/** Mounts the bar under a root that provides a settings page registry, as SharedSettingsPage does. */
function mountBar(entries: SettingsSaveEntry[], hydrated = true): HostNode {
  const bar = hydrated ? Bar : BarBeforeHydration
  const Page = defineComponent({
    setup() {
      const registry = settingsSave.provideSettingsSave()
      for (const candidate of entries) registry.register(candidate)
      return () => h(bar)
    },
  })
  const app = hostRenderer.createApp(Page)
  for (const [name, stub] of Object.entries(DEFAULT_STUBS)) app.component(name, stub)
  const host = createHostNode()
  app.mount(host)
  return host
}

const byTestId = (host: HostNode, id: string) => findNode(host, node => node.props['data-testid'] === id)

describe('SharedSettingsSaveBar', () => {
  it('renders nothing while no card has unsaved edits', () => {
    const host = mountBar([entry({ dirty: false })])
    expect(byTestId(host, 'settings-save-bar')).toBeUndefined()
  })

  it('shows the count, a revert button and a save button on the page bar', () => {
    const host = mountBar([entry({ id: 'a' }), entry({ id: 'b' })])
    const bar = byTestId(host, 'settings-save-bar')!
    expect(bar).toBeTruthy()
    // Clear of the phone tab bar (68px + safe area, z-70) instead of sitting under it at 16px.
    expect(bar.props.class).toContain('--shell-tabbar-height')
    expect(bar.props.class).toContain('md:bottom-4')
    expect(bar.props.class).toContain('rounded-surface')
    expect(bar.props.class).toContain('bg-inverted')
    expect(bar.props.class).toContain('text-inverted')
    expect(bar.props.role).toBe('region')
    expect(bar.props['aria-label']).toBe('app.saveBar')
    expect(findNode(host, node => node.text === 'Unsaved changes: 2')).toBeTruthy()
    expect(byTestId(host, 'settings-save-bar-revert')).toBeTruthy()
    expect(byTestId(host, 'settings-save-bar-save')).toBeTruthy()
  })

  it('keeps one polite live region mounted, filled while the bar shows and empty once it hides', async () => {
    const card = entry({ id: 'a' })
    const host = mountBar([card])
    const live = () => byTestId(host, 'settings-save-bar-announcement')!
    expect(live().props['aria-live']).toBe('polite')
    expect(live().props.class).toContain('sr-only')
    expect(findNode(live(), node => node.text === 'Unsaved changes: 1')).toBeTruthy()
    // The visible sentence is not a live region, so the count is not read twice.
    const bar = byTestId(host, 'settings-save-bar')!
    expect(findNode(bar, node => node.props['aria-live'] !== undefined)).toBeUndefined()

    card.dirty = false
    await nextTick()
    expect(byTestId(host, 'settings-save-bar')).toBeUndefined()
    expect(live()).toBeTruthy()
    expect(findNode(live(), node => node.text === 'Unsaved changes: 0')).toBeUndefined()
  })

  it('exposes the stable slot hook and a visible focus ring on both buttons', () => {
    const host = mountBar([entry()])
    expect(byTestId(host, 'settings-save-bar')!.props['data-slot']).toBe('settings-save-bar')
    for (const id of ['settings-save-bar-revert', 'settings-save-bar-save']) {
      const cls = byTestId(host, id)!.props.class as string
      expect(cls).toContain('focus-visible:outline-default')
      expect(cls).toContain('focus-visible:outline-2')
      expect(cls).toContain('focus-visible:outline-offset-2')
    }
  })

  it('reports a failed card instead of the count', () => {
    const host = mountBar([entry({ id: 'a', failed: true }), entry({ id: 'b' })])
    expect(findNode(host, node => node.text === 'app.saveSomeFailed')).toBeTruthy()
  })

  it('saves and reverts every edited card from the two buttons', async () => {
    const first = entry({ id: 'a' })
    const second = entry({ id: 'b' })
    const host = mountBar([first, second])

    await (byTestId(host, 'settings-save-bar-save')!.props.onClick as () => Promise<void>)()
    expect(first.submit).toHaveBeenCalledTimes(1)
    expect(second.submit).toHaveBeenCalledTimes(1)

    ;(byTestId(host, 'settings-save-bar-revert')!.props.onClick as () => void)()
    expect(first.revert).toHaveBeenCalledTimes(1)
    expect(second.revert).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons until hydration and while a card saves', () => {
    const early = mountBar([entry()], false)
    expect(byTestId(early, 'settings-save-bar-save')!.props.disabled).toBe(true)
    expect(byTestId(early, 'settings-save-bar-revert')!.props.disabled).toBe(true)

    const saving = mountBar([entry({ saving: true })])
    expect(byTestId(saving, 'settings-save-bar-save')!.props.disabled).toBe(true)
    expect(byTestId(saving, 'settings-save-bar-revert')!.props.disabled).toBe(true)
  })
})
