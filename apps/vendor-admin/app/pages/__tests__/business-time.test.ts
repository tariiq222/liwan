import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The control plane cuts days on the Riyadh clock, so the audit log and the AI provider page print its times on that clock too.
describe.each(['audit.vue', 'ai-provider.vue'])('the times of %s', file => {
  const source = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
  it('are formatted in Riyadh time, never in the browser zone', () => {
    expect(source).toContain('formatBusinessDateTime(')
    expect(source).not.toMatch(/\bformatDateTime\(/)
  })
})
