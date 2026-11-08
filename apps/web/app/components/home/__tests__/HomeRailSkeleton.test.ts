import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../HomeRailSkeleton.vue')

describe('HomeRailSkeleton', () => {
  it('is an announced, busy placeholder of three rail-width cards', async () => {
    const html = await renderShared(file, {}, {}, { messages: { 'app.loading': 'جارٍ التحميل' } })
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('جارٍ التحميل')
    expect(html.match(/w-\[300px\]/g)).toHaveLength(3)
  })
})
