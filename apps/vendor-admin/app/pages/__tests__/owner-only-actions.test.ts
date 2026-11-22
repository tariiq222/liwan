import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { operationStatusBadge } from '../../utils/vendorBadges'
import { canPublishRestore } from '../../utils/restorePublication'
import { canAbandonJob } from '../../utils/sharedJobAbandon'
import { canRecoverJob, recoveryTextKey } from '../../utils/sharedJobRecovery'
import { operationTargetTo } from '../../utils/vendorOperations'
import * as ownerOnly from '../../utils/ownerOnly'
import { failureKey } from '../../composables/useStepUp'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { formatBusinessDateTime } from '../../utils/vendorTime'
import { mountPage } from '../../__tests__/pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const restore = { id: 'op1', tenant_id: 't1', request_id: 'r', type: 'restore', status: 'verified', stage: 'verified', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', events: [], restore_publication: { status: 'not_requested', approvalId: 'a1' } }

async function operationPage(grants: string[], data: unknown = restore) {
  const request = vi.fn(async () => data)
  const page = await mountPage('operations/[id].vue', {
    formatBusinessDateTime, operationStatusBadge, safeReturnTo, canPublishRestore, ...ownerOnly, operationTargetTo, canAbandonJob, canRecoverJob, recoveryTextKey, failureKey,
    useRoute: () => ({ params: { id: 'op1' }, query: { source: 'shared' } }), useVendorApi: () => ({ request }), useVendorContext: () => ({ can: (grant: string) => grants.includes(grant) }), navigateTo: vi.fn(),
  })
  mounted.push(page)
  return page
}

it.each([
  ['operations', ['vendor.read', 'vendor.operations.run']],
  ['workspace management', ['vendor.read', 'vendor.tenants.manage']],
])('tells an account with only the %s grant that publishing a restore is the platform owner\'s', async (_name, grants) => {
  const page = await operationPage(grants)
  expect((await page.rendered()).captured.find(node => node.name === 'VendorOwnerOnlyHint')?.props.action).toBe('restorePublication')
  expect(page.state.publishAllowed.value).toBe(false)
})

it('offers the publication to an account holding both grants, with no owner-only text', async () => {
  const page = await operationPage(['vendor.read', 'vendor.operations.run', 'vendor.tenants.manage'])
  expect((await page.rendered()).captured.some(node => node.name === 'VendorOwnerOnlyHint')).toBe(false)
  expect(page.state.publishAllowed.value).toBe(true)
})

it('says nothing about publishing for a restore that is not waiting for publication', async () => {
  const { captured } = await (await operationPage(['vendor.read', 'vendor.operations.run'], { ...restore, restore_publication: { status: 'published', approvalId: 'a1', host: 'h.example.test' } })).rendered()
  expect(captured.some(node => node.name === 'VendorOwnerOnlyHint')).toBe(false)
})

it('tells an account that lacks the operations grant on the new customer page that onboarding a shared workspace is the platform owner\'s', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../customers/new.vue'), 'utf8')
  expect(source).toContain(`<VendorOwnerOnlyHint v-if="sharedEnabled && ownerOnlyAccess('sharedOnboarding', can) === 'partial'" action="sharedOnboarding" />`)
})
