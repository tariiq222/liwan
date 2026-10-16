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
    expect(operations).toMatch(/query: \{ source: 'all', tenant_id: tenantId\.value \}/)
    expect(operations).toContain("path: '/operations', query: { tenant_id: tenantId }")
  })
  it('polls provisioning from one composable and shows only the open-workspace link it publishes', () => {
    expect(workspace).toContain('useWorkspaceProvisioning(tenantId)')
    expect(properties).toContain('useWorkspaceProvisioning(tenantId)')
    expect(read('app/composables/useWorkspaceProvisioning.ts')).toContain('pollCount.value >= POLL_LIMIT')
    expect(workspace + properties).toContain(':to="loginUrl"')
  })
  it('does not repeat the tenant markup in the pages', () => {
    for (const page of ['app/pages/customers/[id].vue', 'app/pages/tenants/[id].vue']) {
      const source = read(page)
      expect(source).not.toContain('operations-grant')
      expect(source).not.toContain('desired_policy')
      expect(source).not.toContain('sharedTenantLoginUrl')
    }
  })
  it('shows a failed tenant load with a retry instead of a blank tab, in all three panels', () => {
    for (const source of [workspace, properties, operations]) {
      expect(source).toContain('error: tenantError')
      expect(source).toMatch(/<SharedPageState :loading="tenantPending && !\w+" :error="tenantError" @retry="refresh\w*">/)
    }
  })
  it('shows a failed recent-operations load as an error with a retry, apart from the empty state', () => {
    expect(operations).not.toMatch(/catch \{/)
    expect(operations).toContain('error: recentError')
    expect(operations).toMatch(/<SharedPageState :loading="recentPending && !recent" :error="recentError" @retry="refreshRecent">\s*<p v-if="!recent\?\.length"/)
  })
})
