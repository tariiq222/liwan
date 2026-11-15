import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../HomeFocusSkeleton.vue')

describe('HomeFocusSkeleton', () => {
  it('is an announced, busy placeholder of five list rows', async () => {
    const html = await renderShared(file, {}, {}, { messages: { 'app.loading': 'جارٍ التحميل' } })
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('جارٍ التحميل')
    expect(html.match(/min-h-14/g)).toHaveLength(5)
  })
})
