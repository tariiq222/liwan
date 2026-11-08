import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { renderShared } from '../../../../../test/helpers/renderShared'

describe('SharedSettingsSection', () => {
  it('is a labelled section with a heading, a one-line description and its content', async () => {
    const html = await renderShared('SettingsSection', { id: 'approvals', title: 'الاعتمادات', description: 'من يعتمد وماذا.' }, { default: () => h('p', 'rows') }, { modules: { '../../../composables/useSettingsNav': { useSettingsNav: () => undefined } } })
    expect(html).toContain('id="approvals"')
    expect(html).toContain('aria-labelledby="approvals-heading"')
    expect(html).toContain('id="approvals-heading"')
    expect(html).toContain('الاعتمادات')
    expect(html).toContain('من يعتمد وماذا.')
    expect(html).toContain('<p>rows</p>')
  })
})
