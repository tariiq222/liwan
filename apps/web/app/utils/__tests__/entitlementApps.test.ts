import { describe, expect, it } from 'vitest'
import { entitledFeaturePrefixes, entitledSelections } from '../entitlementApps'

const release = { applications: [
  { id: 'core', selectable: false, features: [{ key: 'users.limit', kind: 'limit' }] },
  { id: 'projects', selectable: true, features: [{ key: 'pmo.enabled', kind: 'boolean' }, { key: 'meetings.enabled', kind: 'boolean' }, { key: 'projects.max_projects', kind: 'limit' }] },
  { id: 'people', selectable: true, features: [{ key: 'hr.enabled', kind: 'boolean' }] },
] }
const features = { 'users.limit': 5, 'pmo.enabled': true, 'meetings.enabled': false, 'projects.max_projects': 0, 'hr.enabled': false, 'probe.enabled': true }

describe('entitled applications come from features, never from modules', () => {
  it('lists the open <app>.enabled prefixes', () => {
    expect(entitledFeaturePrefixes(features)).toEqual(['pmo', 'probe'])
    expect(entitledFeaturePrefixes(null)).toEqual([])
  })
  it('maps the open booleans onto the release applications', () => {
    expect(entitledSelections(release, features)).toEqual([{ app_id: 'projects', feature_keys: ['pmo.enabled'] }])
    expect(entitledSelections(null, features)).toEqual([])
  })
})
