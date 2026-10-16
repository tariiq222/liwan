import { describe, expect, it } from 'vitest'
import * as errorState from '../../../../utils/errorState'
import { renderShared } from '../../../../../test/helpers/renderShared'

const modules = { '../../../utils/errorState': errorState }

describe('LoadingSkeleton', () => {
  it('announces one loading status with three rows by default', async () => {
    const html = await renderShared('LoadingSkeleton')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="app.loading"')
    expect(html).toContain('data-slot="loading-skeleton"')
    expect(html).toContain('data-variant="rows"')
    expect(html.match(/<div class="h-12"/g)).toHaveLength(3)
  })

  it.each(['record', 'cards'] as const)('renders the %s variant', async variant => {
    const html = await renderShared('LoadingSkeleton', { variant, count: 4 })
    expect(html).toContain(`data-variant="${variant}"`)
    expect(html.match(/role="status"/g)).toHaveLength(1)
  })
})

describe('ErrorState', () => {
  it.each([
    [{ status: 500 }, 'errors.generic'],
    [{ status: 409 }, 'errors.conflict'],
    [undefined, 'errors.generic'],
  ])('titles %o as %s and offers a retry', async (error, title) => {
    const html = await renderShared('ErrorState', { error }, {}, { modules })
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-slot="error-state"')
    expect(html).toContain(title)
    expect(html).toMatch(/<button[^>]*>app\.retry<\/button>/)
  })

  it('takes an explicit title over the mapped one', async () => {
    expect(await renderShared('ErrorState', { error: { status: 409 }, title: 'Custom' }, {}, { modules })).toContain('Custom')
  })

  it('keeps retry disabled until hydration', async () => {
    const html = await renderShared('ErrorState', {}, {}, { modules, hydrated: false })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>app\.retry/)
  })
})

describe('ForbiddenState and NotFoundState', () => {
  it('names the missing permission, with an optional explanation', async () => {
    const html = await renderShared('ForbiddenState', { description: 'Ask an admin' })
    expect(html).toContain('data-slot="forbidden-state"')
    expect(html).toContain('errors.forbidden')
    expect(html).toContain('Ask an admin')
    expect(html).not.toContain('<button')
  })

  it('shows the not-found title and a back link only when there is a target', async () => {
    const bare = await renderShared('NotFoundState')
    expect(bare).toContain('data-slot="not-found-state"')
    expect(bare).toContain('errors.notFound')
    expect(bare).not.toContain('<a')
    const linked = await renderShared('NotFoundState', { backTo: '/projects', backLabel: 'Projects' })
    expect(linked).toMatch(/<a[^>]*href="\/projects"[^>]*>.*Projects/s)
  })
})
