import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../error.vue'), 'utf8')

it('renders the locked-application page only for the two plan denial codes', () => {
  expect(source).toContain("code === 'feature_not_included' || code === 'tenant_read_only'")
  expect(source).toContain('<SubscriptionLockedApplication v-if="locked"')
  expect(source).toContain('planCode.value && me.value ? lockedApplicationView')
})

it('keeps the plain error body for every other status and code', () => {
  expect(source).toContain('<section v-else class="mx-auto grid max-w-md')
  for (const key of ['errors.pageForbiddenTitle', 'errors.pageNotFoundTitle', 'errors.pageErrorTitle', 'app.retry', 'errors.goHome', 'errors.goBack']) expect(source).toContain(key)
})
