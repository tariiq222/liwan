import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : sources(path)
  return /\.(ts|vue)$/.test(entry.name) ? [path] : []
})

describe('the business time zone', () => {
  it('is named once, by BUSINESS_TIME_ZONE, in the control plane and the vendor console', () => {
    const roots = [join(__dirname, '..'), join(__dirname, '../../../vendor-admin/app'), join(__dirname, '../../../vendor-admin/server')]
    const literal = /['"`]Asia\/Riyadh['"`]/
    expect(roots.flatMap(sources).filter(file => literal.test(readFileSync(file, 'utf8')))).toEqual([])
  })
})
