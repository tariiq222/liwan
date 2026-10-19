import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedHeaderTags', () => {
  it('draws a state as a tone pill and a plain fact in the colour of its kind', async () => {
    const html = clean(await renderShared('HeaderTags', { tags: [{ label: 'نشط', tone: 'success', testId: 'state' }, { label: 'سارة', kind: 'person' }] }))
    expect(html).toContain('data-testid="state"')
    expect(html).toContain('rounded-full')
    expect(html).toContain('var(--accent-sky-bg)')
  })

  it('makes a tag with a target a link', async () => {
    const html = clean(await renderShared('HeaderTags', { tags: [{ label: 'المشروع', to: '/projects/1' }] }))
    expect(html).toContain('to="/projects/1"')
  })
})
