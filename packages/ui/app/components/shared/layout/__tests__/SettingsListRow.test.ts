import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'
import * as settingsListName from '../../../../utils/settingsListName'

const modules = { '../../../utils/settingsListName': settingsListName }
const row = (props: Record<string, unknown>) => renderShared('SettingsListRow', props, {}, { modules })

describe('SharedSettingsListRow', () => {
  it('shows the protected badge and no archive button on a value the system needs', async () => {
    const html = await row({ name: 'Other', locked: true, canEdit: true })
    expect(html).toContain('app.list.protected')
    expect(html).not.toContain('app.list.archive')
  })

  it('offers restore with the archived badge on an archived row', async () => {
    const html = await row({ name: 'Old', active: false, canEdit: true })
    expect(html).toContain('app.list.archived')
    expect(html).toContain('app.list.restore')
  })

  it('hides the archive button from a viewer', async () => {
    const html = await row({ name: 'X', canEdit: false })
    expect(html).not.toContain('app.list.archive')
  })
})
