import { describe, expect, it } from 'vitest'
import { entitledFeaturePrefixes } from '../entitlementApps'

const features = { 'users.limit': 5, 'pmo.enabled': true, 'meetings.enabled': false, 'projects.max_projects': 0, 'hr.enabled': false, 'probe.enabled': true }

describe('entitled applications come from features, never from modules', () => {
  it('lists the open <app>.enabled prefixes', () => {
    expect(entitledFeaturePrefixes(features)).toEqual(['pmo', 'probe'])
    expect(entitledFeaturePrefixes(null)).toEqual([])
  })
})
