import { describe, expect, it } from 'vitest'
import * as statusPill from '../../../../utils/statusPill'
import * as statusTone from '../../../../utils/statusTone'
import { renderShared } from '../../../../../test/helpers/renderShared'

const render = (props: Record<string, unknown>) => renderShared('StatusBadge', props, {}, { modules: { '../../../utils/statusTone': statusTone, '../../../utils/statusPill': statusPill } })

describe('StatusBadge', () => {
  it.each([['destructive', 'error'], ['success', 'success'], ['neutral', 'neutral']] as const)('maps %s to the %s colour', async (tone, color) => {
    const html = await render({ tone, label: 'Label' })
    expect(html).toContain(`color="${color}"`)
    expect(html).toContain(`data-tone="${tone}"`)
    expect(html).toContain('variant="subtle"')
    expect(html).toContain('>Label<')
    expect(html).toContain('webvue-pill')
  })

  it('takes the outline variant and a decorative icon', async () => {
    const html = await render({ tone: 'neutral', label: 'L', variant: 'outline', icon: 'i-lucide-user' })
    expect(html).toContain('variant="outline"')
    expect(html).toContain('icon="i-lucide-user"')
  })

  it('passes test ids and data attributes through to the badge', async () => {
    const html = await renderShared('StatusBadge', { tone: 'info', label: 'L', 'data-testid': 'project-status' }, {}, { modules: { '../../../utils/statusTone': statusTone, '../../../utils/statusPill': statusPill } })
    expect(html).toContain('data-testid="project-status"')
  })
})
