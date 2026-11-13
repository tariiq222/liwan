import { describe, expect, it } from 'vitest'
import { SETUP_STEP_KEYS, SetupProgressSchema } from '@liwan/contracts'
import { canUseSetup, handledSteps, setupIsOpen, setupTargetAccess } from '../setupSteps'

const everything = ['settings.company.manage', 'settings.company.read', 'access.users.read', 'inbox.channels.manage', 'customers.read']
const platform = (features: string[]) => ({ readable_features: features, writable_features: features, state: 'active', read_only: false })
const admin = { capabilities: everything, platform: platform(['inbox.enabled', 'customers.enabled']) }
const progress = (outcomes: Array<'done' | 'skipped' | null>, closed_at: string | null = null) => SetupProgressSchema.parse({
  steps: SETUP_STEP_KEYS.map((key, index) => ({ key, outcome: outcomes[index] ?? null, recorded_by: null, recorded_at: null })),
  closed_at, complete: false,
})

describe('who may use the setup page', () => {
  it('admits a holder of settings.company.manage and nobody else', () => {
    expect(canUseSetup(admin)).toBe(true)
    expect(canUseSetup({ capabilities: ['settings.company.read', 'access.users.read'] })).toBe(false)
    expect(canUseSetup({ capabilities: [] })).toBe(false)
  })

  it('refuses a branch session even with the capability', () => {
    expect(canUseSetup({ ...admin, is_root_company: false })).toBe(false)
    expect(canUseSetup({ ...admin, is_root_company: true })).toBe(true)
  })
})

describe('setupTargetAccess', () => {
  it('links each step to the page that owns its work', () => {
    expect(setupTargetAccess(admin, 'company')).toEqual({ kind: 'open', to: '/settings/company' })
    expect(setupTargetAccess(admin, 'team')).toEqual({ kind: 'open', to: '/settings/team/users' })
    expect(setupTargetAccess(admin, 'contacts')).toEqual({ kind: 'open', to: '/customers' })
    expect(setupTargetAccess(admin, 'channels')).toEqual({ kind: 'open', to: '/settings/apps/inbox?tab=channels#channels' })
  })

  it('has no page for the sector step', () => {
    expect(setupTargetAccess(admin, 'sector')).toEqual({ kind: 'none' })
  })

  it('says the application is not in the plan instead of linking to a closed page', () => {
    const noInbox = { ...admin, platform: platform(['customers.enabled']) }
    expect(setupTargetAccess(noInbox, 'channels')).toEqual({ kind: 'feature' })
    expect(setupTargetAccess(noInbox, 'contacts').kind).toBe('open')
  })

  it('says a missing permission when the application is there but the user lacks the capability', () => {
    expect(setupTargetAccess({ ...admin, capabilities: ['settings.company.manage'] }, 'contacts')).toEqual({ kind: 'permission' })
  })
})

describe('progress helpers', () => {
  it('counts skipped steps as handled', () => {
    expect(handledSteps(progress(['done', 'skipped', null, 'done']))).toBe(3)
    expect(handledSteps(progress([]))).toBe(0)
  })

  it('is open only while the wizard has no closed marker', () => {
    expect(setupIsOpen(progress([]))).toBe(true)
    expect(setupIsOpen(progress([], '2026-11-13T10:00:00'))).toBe(false)
    expect(setupIsOpen(undefined)).toBe(false)
  })
})
