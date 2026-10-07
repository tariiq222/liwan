import { describe, expect, it } from 'vitest'
import { KNOWN_CAPABILITIES, MeSchema } from '@nasq/contracts'
import { canUse, featureForCapability, featureForPath, hasFeature, isWriteCapability } from '../registry'
import { firstAllowedPath, postLoginPath } from '../../utils/accessPolicy'
import { useNav } from '../../composables/nav/shellModules'

const caps = ['pmo.tasks.read', 'pmo.projects.read', 'meetings.read', 'hr.employees.read']
const withdrawnPmo = {
  role: 'employee',
  capabilities: caps,
  modules: ['nasq_pmo', 'nasq_hr'],
  entitlements: { 'pmo.enabled': false, 'meetings.enabled': true, 'hr.enabled': true, 'chat.enabled': false },
  platform: {
    readable_features: ['meetings.enabled', 'hr.enabled'],
    writable_features: ['meetings.enabled', 'hr.enabled'],
  },
}

describe('module registry', () => {
  it('hides withdrawn project navigation while keeping meetings', () => {
    expect(hasFeature(withdrawnPmo, 'pmo.enabled')).toBe(false)
    expect(useNav(withdrawnPmo).map(item => item.to)).toEqual([
      '/meetings', '/meetings/calendar', '/meetings/series', '/hr',
    ])
    expect(firstAllowedPath(withdrawnPmo)).toBe('/meetings')
    expect(postLoginPath(withdrawnPmo, '/projects')).toBe('/meetings')
  })
  it('does not hide modules when the payload has no tenant policy', () => {
    expect(useNav({ capabilities: caps }).map(item => item.to)).toContain('/projects')
  })
  it('lands a parsed task-reader identity with pmo enabled on /tasks', () => {
    const me = MeSchema.parse({
      id: 1, name: 'Admin', login: 'admin', email: '', lang: 'ar_001', tz: '',
      role: 'admin', company: { id: 1, name: 'nasq' },
      roles: [], capabilities: ['pmo.tasks.read'], access_policy_version: 1,
      modules: ['nasq_pmo'],
      entitlements: { 'pmo.enabled': true },
      platform: {
        schema_version: 1, policy_revision: 1, state: 'active',
        valid_until: null, read_only: false,
        readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'],
      },
      terminology: { ar: {}, en: {} },
    })
    expect(firstAllowedPath(me)).toBe('/tasks')
    expect(postLoginPath(me, undefined)).toBe('/tasks')
  })
  it('maps write routes to the owning feature', () => {
    expect(featureForPath('/projects/new')).toBe('pmo.enabled')
    expect(canUse(withdrawnPmo, 'pmo.projects.create', true)).toBe(false)
    expect(canUse(withdrawnPmo, 'meetings.create', true)).toBe(true)
  })
})

// The client gate of every capability before the derivation (registry.ts at 1aa7c4b4):
// [capability, feature, write]. meetings.manage is the one intended change (ruling 4).
const TODAY: ReadonlyArray<readonly [string, string | null, boolean]> = [
  ['access.users.read', null, false], ['access.users.grant', null, true],
  ['access.users.assign_roles', null, true], ['access.users.disable', null, true],
  ['access.users.reset_password', null, true], ['access.roles.read', null, false],
  ['access.roles.manage', null, true], ['access.audit.read', null, false],
  ['hr.employees.read', 'hr.enabled', false], ['hr.employees.manage', 'hr.enabled', true],
  ['hr.employees.archive', 'hr.enabled', true], ['hr.employees.access_status.read', 'hr.enabled', false],
  ['hr.departments.read', 'hr.enabled', false], ['hr.departments.manage', 'hr.enabled', true],
  ['hr.documents.read', 'hr.enabled', false], ['hr.documents.manage', 'hr.enabled', true],
  ['pmo.projects.read', 'pmo.enabled', false], ['pmo.projects.create', 'pmo.enabled', true],
  ['pmo.projects.manage', 'pmo.enabled', true], ['pmo.settings.manage', 'pmo.enabled', true],
  ['pmo.tasks.read', 'pmo.enabled', false], ['pmo.tasks.create', 'pmo.enabled', true],
  ['pmo.tasks.write', 'pmo.enabled', true], ['pmo.tasks.approve', 'pmo.enabled', true],
  ['settings.branding.manage', null, true],
  ['meetings.read', 'meetings.enabled', false], ['meetings.create', 'meetings.enabled', true],
  ['nasq.internal', 'chat.enabled', false],
]

describe('capability gate derivation', () => {
  it("keeps the gate of every one of today's capabilities except meetings.manage", () => {
    for (const [capability, feature, write] of TODAY) {
      expect([capability, featureForCapability(capability), isWriteCapability(capability)]).toEqual([capability, feature, write])
    }
    const listed = new Set(TODAY.map(([capability]) => capability))
    expect(KNOWN_CAPABILITIES.filter(key => !listed.has(key))).toEqual(['meetings.manage'])
  })

  it('leaves the foundation, vendor and subscription prefixes ungated by any application feature', () => {
    const locked = { platform: { readable_features: [], writable_features: [] } }
    for (const capability of ['vendor', 'vendor.read', 'vendor.audit.read', 'vendor.tenants.manage', 'subscription.read', 'billing.read', 'branches.manage', 'nasq.notifications', 'access.users.grant', 'settings.branding.manage']) {
      expect(featureForCapability(capability), capability).toBeNull()
      // nasq.notifications is the bell: canUse gates it on pmo/meetings, so it is only checked above.
      if (capability !== 'nasq.notifications') expect(canUse(locked, capability, true), capability).toBe(true)
    }
  })

  it('turns meetings.manage into a write that only a writable meetings feature opens', () => {
    expect(featureForCapability('meetings.manage')).toBe('meetings.enabled')
    expect(isWriteCapability('meetings.manage')).toBe(true)
    const readOnly = {
      capabilities: ['meetings.read', 'meetings.create', 'meetings.manage'],
      platform: { readable_features: ['meetings.enabled'], writable_features: [] },
    }
    expect(canUse(readOnly, 'meetings.read')).toBe(true)
    // series/[id].vue canAddOccurrence = can('meetings.create') && (can('meetings.manage') || organizer):
    // meetings.create was already closed on a read-only tenant, so no visible control changes.
    expect(canUse(readOnly, 'meetings.create')).toBe(false)
    expect(canUse(readOnly, 'meetings.manage')).toBe(false)
    const writable = { ...readOnly, platform: { readable_features: ['meetings.enabled'], writable_features: ['meetings.enabled'] } }
    expect(canUse(writable, 'meetings.create')).toBe(true)
    expect(canUse(writable, 'meetings.manage')).toBe(true)
  })

  it('gates a newer application by its own <app>.enabled feature and action', () => {
    expect(featureForCapability('sales.orders.read')).toBe('sales.enabled')
    expect(featureForCapability('sales.orders.write')).toBe('sales.enabled')
    expect(isWriteCapability('sales.orders.read')).toBe(false)
    expect(isWriteCapability('sales.orders.write')).toBe(true)
    expect(isWriteCapability('sales.reports.export')).toBe(true)
    const tenant = (readable: string[], writable: string[]) => ({
      capabilities: ['sales.orders.read', 'sales.orders.write'],
      modules: ['nasq_sales'],
      entitlements: { 'sales.enabled': readable.includes('sales.enabled') },
      platform: { readable_features: readable, writable_features: writable },
    })
    expect(canUse(tenant(['sales.enabled'], ['sales.enabled']), 'sales.orders.write')).toBe(true)
    expect(canUse(tenant(['sales.enabled'], []), 'sales.orders.read')).toBe(true)
    expect(canUse(tenant(['sales.enabled'], []), 'sales.orders.write')).toBe(false)
    expect(canUse(tenant([], []), 'sales.orders.read')).toBe(false)
    expect(canUse({ capabilities: ['sales.orders.write'] }, 'sales.orders.write')).toBe(true)
    expect(hasFeature(tenant(['sales.enabled'], []), 'sales.enabled')).toBe(true)
  })
})
