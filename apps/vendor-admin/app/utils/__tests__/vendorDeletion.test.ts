import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tenantDeletionStateSchema, type TenantDeletionRequest } from '@liwan/commercial-contracts'
import { isDeletionShown } from '../vendorDeletion'

const webRoot = resolve(import.meta.dirname, '../../..')
const request = (state: TenantDeletionRequest['state'], deleting_at: string | null = null) => ({ state, deleting_at }) as TenantDeletionRequest

describe('deletion request texts', () => {
  it('has a sentence in both languages for every state the customer page can show', () => {
    const shown = tenantDeletionStateSchema.options.filter(state => isDeletionShown(request(state, '2026-11-01T00:00:00Z')))
    expect(shown).toContain('withdrawn')
    for (const lang of ['ar', 'en']) {
      const deletion = JSON.parse(readFileSync(resolve(webRoot, `i18n/locales/${lang}/vendor.json`), 'utf8')).vendor.customers.deletion
      for (const state of shown) expect(deletion[state], `${lang}: ${state}`).toEqual(expect.any(String))
    }
  })

  it('does not poll the provisioning of a workspace that is being deleted or is gone, and creates the poll after the flag it reads', () => {
    const customerPage = readFileSync(resolve(webRoot, 'app/pages/customers/[id].vue'), 'utf8')
    expect(customerPage).toContain('useWorkspaceProvisioning(tenantId, () => !isChild.value && !workspaceRetiring.value &&')
    expect(customerPage.indexOf('const workspaceRetiring')).toBeLessThan(customerPage.indexOf('const progress = useWorkspaceProvisioning'))
    expect(readFileSync(resolve(webRoot, 'app/pages/tenants/[id].vue'), 'utf8')).toContain("data.value?.status !== 'deleted'")
  })
})
