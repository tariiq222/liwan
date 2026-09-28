import { describe, expect, it } from 'vitest'
import { resolveTenantHost } from '../tenantHostResolver'

const targets = [
  { host: 'alpha.example.test', tenantId: 'tenant-a', database: 'nasq_a', filestore: 'files_a', enabled: true, registryRevision: 1 },
  { host: 'beta.example.test', tenantId: 'tenant-b', database: 'nasq_b', filestore: 'files_b', enabled: true, registryRevision: 1 },
]

describe('exact tenant Host resolver (synthetic only)', () => {
  it('resolves a canonical registered Host to exactly one database and filestore', () => {
    expect(resolveTenantHost('alpha.example.test', targets)).toEqual({ tenantId: 'tenant-a', database: 'nasq_a', filestore: 'files_a', registryRevision: 1 })
    expect(resolveTenantHost('BETA.EXAMPLE.TEST', targets)).toEqual({ tenantId: 'tenant-b', database: 'nasq_b', filestore: 'files_b', registryRevision: 1 })
  })

  it.each([undefined, '', 'gamma.example.test', 'alpha.example.test.evil.test', 'alpha.example.test.', 'alpha.example.test:443', 'alpha.example.test, beta.example.test', ' alpha.example.test', 'alpha.example.test\n', 'https://alpha.example.test', 'alpha.example.test/path', 'αlpha.example.test', '127.0.0.1'])('rejects unknown or malformed Host %s', (host) => {
    expect(() => resolveTenantHost(host, targets)).toThrow()
  })

  it('rejects disabled targets, ambiguous hosts and duplicate tenant identity', () => {
    expect(() => resolveTenantHost('alpha.example.test', [{ ...targets[0]!, enabled: false }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [targets[0]!, { ...targets[1]!, host: 'ALPHA.EXAMPLE.TEST' }])).toThrow()
    expect(() => resolveTenantHost('beta.example.test', [targets[0]!, { ...targets[1]!, tenantId: 'tenant-a' }])).toThrow()
  })

  it('rejects non-string identities and forged duplicate resource values', () => {
    expect(() => resolveTenantHost('alpha.example.test', [{ host: 'alpha.example.test', enabled: true, registryRevision: 1 } as typeof targets[number]])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [{ ...targets[0]!, database: ['nasq_a'] as unknown as string }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [targets[0]!, { ...targets[1]!, database: ['nasq_a'] as unknown as string }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [{ ...targets[0]!, tenantId: ['tenant-a'] as unknown as string }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [{ ...targets[0]!, filestore: ['files_a'] as unknown as string }])).toThrow()
  })

  it('rejects Unicode compatibility folds and terminal newlines in a request or registry', () => {
    expect(() => resolveTenantHost('Kappa.example.test', [{ ...targets[0]!, host: 'kappa.example.test' }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test\n', [{ ...targets[0]!, host: 'alpha.example.test\n' }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [{ ...targets[0]!, host: 'alpha.example.test\n' }])).toThrow()
  })

  it('rejects invalid registry rows even if the requested Host looks valid', () => {
    expect(() => resolveTenantHost('alpha.example.test', [targets[0]!, { ...targets[1]!, database: 'nasq_a' }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [targets[0]!, { ...targets[1]!, host: 'bad/host' }])).toThrow()
    expect(() => resolveTenantHost('alpha.example.test', [targets[0]!, { ...targets[1]!, filestore: '../files' }])).toThrow()
  })
})
