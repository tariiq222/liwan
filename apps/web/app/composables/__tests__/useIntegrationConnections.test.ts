import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(join(import.meta.dirname, '..', file), 'utf8')
const connections = read('useIntegrationConnections.ts')
const providers = read('useIntegrationProviders.ts')

describe('useIntegrationConnections', () => {
  it('reads the list and one connection through the contract schemas, only while enabled', () => {
    expect(connections).toContain("'/api/v1/integrations/connections'")
    expect(connections).toContain('schema: IntegrationConnectionListSchema')
    expect(connections).toContain('schema: IntegrationConnectionSchema')
    expect(connections).toMatch(/enabled: \(\) => toValue\(enabled\)/)
  })

  it('sends each write to its route with the contract answer', () => {
    expect(connections).toMatch(/method: 'POST', body, schema: IntegrationConnectionSchema/)
    expect(connections).toMatch(/method: 'PATCH', body, schema: IntegrationConnectionSchema/)
    expect(connections).toContain('/test`, { method: \'POST\'')
    expect(connections).toContain('/secrets/${name}/rotate`')
    expect(connections).toContain('schema: IntegrationSecretRotationSchema')
    expect(connections).toContain("{ method: 'DELETE' }")
  })

  it('replaces the cached connection with the answer and never caches a rotated value', () => {
    expect(connections).toContain('storeConnection(list, connection)')
    expect(connections).toContain('dropConnection(list,')
    const rotation = connections.slice(connections.indexOf('export function useRotateIntegrationSecret'), connections.indexOf('export function useDeleteIntegrationConnection'))
    expect(rotation).not.toContain('setQueryData')
  })
})

describe('useIntegrationProviders', () => {
  it('reads the providers and starts OAuth through the contract schemas', () => {
    expect(providers).toContain("'/api/v1/integrations/providers'")
    expect(providers).toContain('schema: IntegrationProviderListSchema')
    expect(providers).toContain('/api/v1/integrations/oauth/${provider}/start')
    expect(providers).toContain('schema: IntegrationOAuthStartResponseSchema')
    expect(providers).toContain('enabled')
  })
})
