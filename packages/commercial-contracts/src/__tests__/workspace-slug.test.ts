import { describe, expect, it } from 'vitest'
import { RESERVED_WORKSPACE_SLUGS, normalizeWorkspaceSlug, workspaceSlugSchema } from '../workspace-slug.js'

const accepts = (value: string) => workspaceSlugSchema.safeParse(value).success

describe('workspace slug', () => {
  it('accepts a name, a name with a number and a mixed one', () => {
    expect(workspaceSlugSchema.parse('acme')).toBe('acme')
    expect(workspaceSlugSchema.parse('acme-2')).toBe('acme-2')
    expect(workspaceSlugSchema.parse('a1b')).toBe('a1b')
  })
  it('trims and lowercases before checking', () => {
    expect(normalizeWorkspaceSlug('  Acme-2 ')).toBe('acme-2')
    expect(workspaceSlugSchema.parse(' ACME ')).toBe('acme')
    expect(accepts(' Acme-2 ')).toBe(true)
  })
  it('holds 3 to 30 characters', () => {
    expect(accepts('ab')).toBe(false)
    expect(accepts('a'.repeat(30))).toBe(true)
    expect(accepts('a'.repeat(31))).toBe(false)
  })
  it('rejects a leading, trailing or doubled hyphen and every character outside the host alphabet', () => {
    for (const value of ['-acme', 'acme-', 'a--b', 'ac_me', 'acme.co', 'acmé']) expect(accepts(value)).toBe(false)
  })
  it('rejects a name made only of digits', () => {
    for (const value of ['123', '1234567']) expect(accepts(value)).toBe(false)
    expect(accepts('123a')).toBe(true)
  })
  it('rejects the claimed-authority prefixes', () => {
    for (const value of ['xn--foo', 'gov-x', 'bank-x']) expect(accepts(value)).toBe(false)
    expect(accepts('xnfoo')).toBe(true)
  })
  it('rejects a reserved name from every group, matched after normalization', () => {
    const samples = { infrastructure: 'api', application: 'crm', business: 'office', authority: 'gov' }
    for (const [group, value] of Object.entries(samples)) expect(accepts(value), group).toBe(false)
    expect(accepts(' localhost ')).toBe(false)
    expect(accepts('Saudi')).toBe(false)
    expect(RESERVED_WORKSPACE_SLUGS.has('liwanos')).toBe(true)
  })
  it('pins the exact reserved list', () => {
    const expected = [
      'www', 'api', 'app', 'mail', 'smtp', 'imap', 'pop', 'mx', 'ns1', 'ns2', 'cdn', 'static', 'assets', 'media', 'files',
      'staging', 'prod', 'dev', 'test', 'demo', 'sandbox', 'preview', 'status', 'docs', 'help', 'support', 'billing', 'pay',
      'portal', 'auth', 'login', 'sso', 'account', 'signup', 'register', 'hooks', 'webhook', 'restore', 'admin', 'vendor',
      'internal', 'localhost',
      'liwan', 'liwanos', 'crm', 'hr', 'erp', 'pmo', 'tasks', 'projects', 'finance', 'inbox', 'meetings', 'ai', 'chat',
      'documents', 'helpdesk', 'sales', 'appointments', 'odoo',
      'company', 'office', 'system', 'platform', 'business', 'store', 'shop', 'team', 'root', 'owner', 'manager',
      'workspace', 'enterprise', 'group', 'official',
      'gov', 'government', 'bank', 'ministry', 'police', 'absher', 'zatca', 'sama', 'moh', 'saudi', 'ksa',
    ]
    expect(RESERVED_WORKSPACE_SLUGS.size).toBe(expected.length)
    expect([...RESERVED_WORKSPACE_SLUGS].sort()).toEqual([...expected].sort())
  })
})
