import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import * as errorState from '../../../utils/errorState'
import { renderShared } from './helpers/renderShared'

const render = (props: Record<string, unknown>) =>
  renderShared('PageState', props, { default: () => h('p', 'CONTENT') }, { modules: { '@/utils/errorState': errorState } })

describe('PageState facade', () => {
  it('shows the loading skeleton before anything else', async () => {
    const html = await render({ loading: true, error: { status: 500 }, empty: true })
    expect(html).toContain('data-slot="loading-skeleton"')
    expect(html).not.toContain('CONTENT')
  })

  it('maps every error shape to one state', async () => {
    const cases: [unknown, string, boolean][] = [
      [{ status: 403 }, 'forbidden-state', false],
      [{ statusCode: 404 }, 'not-found-state', false],
      [{ status: 409 }, 'error-state', true],
      [new Error('Failed to fetch'), 'error-state', true],
      ['boom', 'error-state', true],
    ]
    for (const [error, slot, retry] of cases) {
      const html = await render({ error })
      expect(html, String(slot)).toContain(`data-slot="${slot}"`)
      expect(html.includes('app.retry'), `${slot} retry`).toBe(retry)
      expect(html).not.toContain('CONTENT')
    }
    expect(await render({ error: { status: 409 } })).toContain('errors.conflict')
  })

  it('shows the empty state with the caller text or the default', async () => {
    expect(await render({ empty: true, emptyText: 'No projects' })).toContain('No projects')
    expect(await render({ empty: true })).toContain('app.noResults')
  })

  it('renders its content when nothing else applies', async () => {
    expect(await render({})).toContain('CONTENT')
  })
})
