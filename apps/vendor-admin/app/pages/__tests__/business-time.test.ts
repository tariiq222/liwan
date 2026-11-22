import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The control plane cuts days on the Riyadh clock, so the audit log and the AI provider page print its times on that clock too.
describe.each(['audit.vue', 'ai-provider.vue'])('the times of %s', file => {
  const source = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
  it('are formatted in Riyadh time, never in the browser zone', () => {
    expect(source).toContain('formatBusinessDateTime(')
    expect(source).not.toMatch(/\bformatDateTime\(/)
  })
})

// Every time the console shows is a commercial or operational event of the business (invoices, payments, operations, customers, team).
const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  if (name === '__tests__') return []
  return statSync(path).isDirectory() ? sources(path) : /\.(vue|ts)$/.test(name) ? [path] : []
})
describe('the whole console', () => {
  const root = resolve(import.meta.dirname, '../..')
  it('formats no date or time in the browser zone', () => {
    const offenders = sources(root).filter(file => !file.endsWith('utils/vendorTime.ts')).filter(file => /\b(?:formatLiwanDate|formatLiwanDateTime|formatDate|formatDateTime)\(/.test(readFileSync(file, 'utf8')))
    expect(offenders.map(file => file.slice(root.length + 1))).toEqual([])
  })
})
