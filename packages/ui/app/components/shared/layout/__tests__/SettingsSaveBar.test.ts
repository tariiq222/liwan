import { defineComponent, h, reactive } from 'vue'
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
    expect(bar.props.class).toContain('sticky bottom-4')
    expect(bar.props.class).toContain('rounded-surface')
    expect(bar.props.class).toContain('bg-inverted')
    expect(bar.props.class).toContain('text-inverted')
    expect(bar.props.role).toBe('region')
    expect(bar.props['aria-label']).toBe('app.saveBar')
    expect(findNode(host, node => node.text === 'Unsaved changes: 2')).toBeTruthy()
    expect(byTestId(host, 'settings-save-bar-revert')).toBeTruthy()
    expect(byTestId(host, 'settings-save-bar-save')).toBeTruthy()
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
