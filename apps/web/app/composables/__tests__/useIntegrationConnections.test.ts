import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(import.meta.dirname, '../useIntegrationConnections.ts'), 'utf8')

describe('useIntegrationConnections', () => {
  it('reads the status list through the contract schema and only while enabled', () => {
    expect(source).toContain("'/api/v1/integrations/connections'")
    expect(source).toContain('schema: IntegrationConnectionListSchema')
    expect(source).toContain('enabled')
  })

  it('is read-only: it sends no mutation and no secret', () => {
    expect(source).not.toMatch(/useMutation|method:|body:/)
  })
})
