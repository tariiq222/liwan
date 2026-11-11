import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const MenuStub = { inheritAttrs: false, setup: (_: unknown, { slots }: { slots: { default?: () => unknown } }) => () => slots.default?.() }

describe('SharedRowActions', () => {
  const options = { stubs: { UDropdownMenu: MenuStub as never } }

  it('names a single action by the action and the record, so rows do not repeat one label', async () => {
    const html = await renderShared('RowActions', { label: 'Actions for Admin role', actions: [{ label: 'View', to: '/roles/1' }] }, {}, options)
    expect(html).toContain('aria-label="View: Actions for Admin role"')
    expect(html).toContain('data-testid="row-action"')
  })

  it('names the menu button by the record', async () => {
    const html = await renderShared('RowActions', { label: 'Actions for Admin role', actions: [{ label: 'View' }, { label: 'Edit' }] }, {}, options)
    expect(html).toContain('aria-label="Actions for Admin role"')
    expect(html).not.toContain('data-testid="row-action"')
  })
})
