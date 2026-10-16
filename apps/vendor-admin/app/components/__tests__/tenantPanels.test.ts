import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const operations = read('app/components/vendor/TenantOperationsPanel.vue')
const workspace = read('app/components/vendor/WorkspacePanel.vue')
const properties = read('app/components/vendor/TenantProperties.vue')

describe('workspace panels shared by the customer page and the workspace page', () => {
  it('keeps the operations capability gates and the inline revoke confirmation', () => {
    expect(operations).toContain("canVendor('vendor.tenants.manage')")
    expect(operations).toContain("canVendor('vendor.operations.run')")
    expect(operations).toContain('<SharedInlineConfirm')
    expect(operations).not.toContain('<UModal')
  })
  it('reports unsent input to the page, which guards leaving with it, and clears it on unmount', () => {
    expect(operations).toContain("defineModel<boolean>('dirty'")
    expect(operations).toContain('onBeforeUnmount(() => { dirtyModel.value = false })')
    expect(operations).not.toContain('SharedUnsavedChanges')
  })
  it('lists the latest operations of the workspace and links to the filtered operations list', () => {
    expect(operations).toContain('useTenantRecentOperations(tenantId)')
    expect(read('app/composables/useTenantRecentOperations.ts')).toMatch(/query: \{ source: 'all', tenant_id: toValue\(id\) \}/)
    expect(operations).toContain("path: '/operations', query: { tenant_id: tenantId }")
  })
  it('polls provisioning once, from the page, and hands the state to the panels', () => {
    expect(read('app/composables/useWorkspaceProvisioning.ts')).toContain('pollCount.value >= POLL_LIMIT')
    for (const source of [workspace, properties]) {
      expect(source).not.toContain('useWorkspaceProvisioning(')
      expect(source).not.toContain('useVendorTenant(')
      expect(source).toContain('progress: WorkspaceProvisioning')
    }
    expect(workspace + properties).toContain(':to="progress.loginUrl"')
    expect(read('app/pages/customers/[id].vue').match(/useWorkspaceProvisioning\(/g)).toHaveLength(1)
    expect(read('app/pages/tenants/[id].vue').match(/useWorkspaceProvisioning\(/g)).toHaveLength(1)
  })
  it('does not repeat the tenant markup in the pages', () => {
    for (const page of ['app/pages/customers/[id].vue', 'app/pages/tenants/[id].vue']) {
      const source = read(page)
      expect(source).not.toContain('operations-grant')
      expect(source).not.toContain('desired_policy')
      expect(source).not.toContain('sharedTenantLoginUrl')
    }
  })
  it('shows a failed tenant load with one retry instead of a blank tab: the page owns it for the workspace tab, the operations panel for its own', () => {
    expect(operations).toMatch(/<SharedPageState :loading="tenantPending && !data" :error="tenantError" @retry="refresh">/)
    expect(read('app/pages/customers/[id].vue')).toMatch(/<SharedPageState v-else-if="tab === 'workspace'" :loading="tenantPending && !tenant" :error="tenantError" @retry="refreshTenant">/)
    for (const source of [workspace, properties]) expect(source).not.toContain('SharedPageState')
  })
  it('shows a failed recent-operations load as an error with a retry, apart from the empty state', () => {
    expect(operations).not.toMatch(/catch \{/)
    expect(operations).toContain('error: recentError')
    expect(operations).toMatch(/<SharedPageState :loading="recentPending && !recent" :error="recentError" @retry="refreshRecent">\s*<p v-if="!recent\?\.length"/)
  })
})
