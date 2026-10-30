import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

// The section stub draws its actions slot too, where the view-only badge sits.
const SharedRecordSection = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs, slots }) => () => h('section', attrs, [slots.actions?.(), slots.default?.()]),
})
const stubs = { SharedRecordSection }
const card = (props: Record<string, unknown>) => renderShared('SettingsCard', { id: 'followup', title: 'Follow-up', canEdit: true, ...props }, {
  default: () => h('p', 'FIELDS'),
}, { stubs })

describe('SharedSettingsCard', () => {
  it('is the anchored panel card with its fields as setting rows and one footer: revert, then save', async () => {
    const html = await card({ dirty: true })
    expect(html).toContain('id="followup"')
    expect(html).toContain('liwan-settings-anchor')
    expect(html).toContain('variant="panel"')
    expect(html).toMatch(/class="liwan-setting-rows">(<!--\[-->)?<p>FIELDS<\/p>/)
    expect(html.indexOf('app.revert')).toBeLessThan(html.indexOf('app.saveChanges'))
    expect(html).not.toContain('app.viewOnly')
  })

  it('shows a viewer the view-only badge and no footer', async () => {
    const html = await card({ canEdit: false })
    expect(html).toContain('app.viewOnly')
    expect(html).not.toContain('app.saveChanges')
    expect(html).not.toContain('app.revert')
  })

  it('shows a failed save inside the card, and on a conflict the reload button', async () => {
    const html = await card({ dirty: true, conflict: true, message: 'CHANGED' })
    expect(html).toContain('app.saveFailed')
    expect(html).toContain('CHANGED')
    expect(html).toContain('app.reloadCurrent')
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
