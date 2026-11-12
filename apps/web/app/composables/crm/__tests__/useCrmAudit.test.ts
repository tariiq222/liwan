import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const { crmAuditOffset, useCrmAuditAccess, CRM_AUDIT_PAGE_SIZE } = await import('../useCrmAudit')

function viewer(capabilities: string[], features: string[]) {
  const identity = { capabilities, platform: { readable_features: features, writable_features: [] } }
  vi.stubGlobal('useAccess', () => ({ can: (capability: string) => capabilities.includes(capability) }))
  vi.stubGlobal('useMe', () => ({ me: ref(identity) }))
}

describe('crmAuditOffset', () => {
  it('pages the view log by its page size', () => {
    expect(crmAuditOffset(1)).toBe(0)
    expect(crmAuditOffset(3)).toBe(2 * CRM_AUDIT_PAGE_SIZE)
  })
})

describe('useCrmAuditAccess', () => {
  it('opens the view log to a user with the audit capability on an enabled CRM', () => {
    viewer(['crm.audit.read'], ['crm.enabled'])
    expect(useCrmAuditAccess().value).toBe(true)
  })

  it('closes it without the audit capability, even on an enabled CRM', () => {
    viewer(['crm.leads.read'], ['crm.enabled'])
    expect(useCrmAuditAccess().value).toBe(false)
  })

  it('closes it when the CRM is not included in the package', () => {
    viewer(['crm.audit.read'], [])
    expect(useCrmAuditAccess().value).toBe(false)
  })
})
