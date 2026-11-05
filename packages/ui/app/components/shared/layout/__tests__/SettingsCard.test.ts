import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { SettingsSaveEntry, SettingsSaveRegistry } from '../../../../composables/useSettingsSave'
import { renderShared } from '../../../../../test/helpers/renderShared'

// The section stub draws its actions slot too, where the view-only and unsaved badges sit.
const SharedRecordSection = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs, slots }) => () => h('section', attrs, [slots.actions?.(), slots.default?.()]),
})
const stubs = { SharedRecordSection }

/** A stand-in page registry: it records what the card registers, as the real one does. */
function pageRegistry() {
  const entries = new Map<string, SettingsSaveEntry>()
  const registry: SettingsSaveRegistry = {
    pending: { value: 0 } as never,
    saving: { value: false } as never,
    failed: { value: false } as never,
    register(entry) {
      entries.set(entry.id, entry)
      return () => { entries.delete(entry.id) }
    },
    saveAll: async () => undefined,
    revertAll: () => undefined,
  }
  return { registry, entries }
}

const render = (props: Record<string, unknown>, registry?: SettingsSaveRegistry) =>
  renderShared('SettingsCard', { id: 'followup', title: 'Follow-up', canEdit: true, ...props }, {
    default: () => h('p', 'FIELDS'),
  }, {
    stubs,
    modules: { '../../../composables/useSettingsSave': { useSettingsSaveRegistry: () => registry ?? null } },
  })

describe('SharedSettingsCard', () => {
  it('is the anchored panel card with its fields as setting rows and one footer: revert, then save', async () => {
    const html = await render({ dirty: true })
    expect(html).toContain('id="followup"')
    expect(html).toContain('liwan-settings-anchor')
    expect(html).toContain('variant="panel"')
    expect(html).toMatch(/class="liwan-setting-rows">(<!--\[-->)?<p>FIELDS<\/p>/)
    expect(html.indexOf('app.revert')).toBeLessThan(html.indexOf('app.saveChanges'))
    expect(html).not.toContain('app.viewOnly')
    expect(html).not.toContain('app.unsaved')
  })

  it('shows a viewer the view-only badge and no footer', async () => {
    const html = await render({ canEdit: false })
    expect(html).toContain('app.viewOnly')
    expect(html).not.toContain('app.saveChanges')
    expect(html).not.toContain('app.revert')
  })

  it('shows a failed save inside the card, and on a conflict the reload button', async () => {
    const html = await render({ dirty: true, conflict: true, message: 'CHANGED' })
    expect(html).toContain('app.saveFailed')
    expect(html).toContain('CHANGED')
    expect(html).toContain('app.reloadCurrent')
  })

  it('registers with the settings page and draws no footer, only the unsaved badge while dirty', async () => {
    const page = pageRegistry()
    const dirty = await render({ dirty: true }, page.registry)
    expect([...page.entries.keys()]).toEqual(['followup'])
    expect(page.entries.get('followup')?.dirty).toBe(true)
    expect(dirty).toContain('app.unsaved')
    expect(dirty).not.toContain('app.revert')
    expect(dirty).not.toContain('app.saveChanges')

    const clean = await render({}, pageRegistry().registry)
    expect(clean).not.toContain('app.unsaved')
  })

  it('runs its save handler and resolves after it when the page bar asks, and reverts through its event', async () => {
    const page = pageRegistry()
    let saved = false
    await render({ dirty: true, onSave: async () => { saved = true } }, page.registry)
    const entry = page.entries.get('followup')!
    await entry.submit()
    expect(saved).toBe(true)
    expect(entry.revert).toBeTypeOf('function')
  })

  it('keeps its own footer for an action card with a save label, even inside a settings page', async () => {
    const page = pageRegistry()
    const html = await render({ dirty: true, saveLabel: 'APPLY PRESET' }, page.registry)
    expect(html).toContain('APPLY PRESET')
    expect(html).toContain('app.revert')
    expect(html.indexOf('app.revert')).toBeLessThan(html.indexOf('APPLY PRESET'))
    expect(html).not.toContain('app.unsaved')
    expect(page.entries.size).toBe(0)
  })
})

describe('SharedSettingsList', () => {
  const list = (props: Record<string, unknown>) => renderShared('SettingsList', { id: 'sources', title: 'Sources', canEdit: true, ...props }, {
    default: () => h('li', 'ROW'),
    add: () => h('input', { 'aria-label': 'NEW' }),
  }, { stubs })

  it('is the anchored panel card with the rows and an add form', async () => {
    const html = await list({})
    expect(html).toContain('id="sources"')
    expect(html).toContain('<li>ROW</li>')
    expect(html).toContain('aria-label="NEW"')
    expect(html).toContain('app.list.add')
  })

  it('hides the add form from a viewer and says the list is empty', async () => {
    const html = await list({ canEdit: false, empty: true })
    expect(html).toContain('app.viewOnly')
    expect(html).toContain('app.list.empty')
    expect(html).not.toContain('app.list.add')
  })
})
