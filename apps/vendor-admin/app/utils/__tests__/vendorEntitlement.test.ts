import { describe, expect, it } from 'vitest'
import { entitledSelections } from '../vendorEntitlement'

const release = { applications: [
  { id: 'core', selectable: false, features: [{ key: 'users.limit', kind: 'limit' }] },
  // A6: a tier is for sale only when it says so; `selectable` alone grants nothing.
  { id: 'projects', selectable: true, sellable: true, features: [{ key: 'pmo.enabled', kind: 'boolean' }, { key: 'meetings.enabled', kind: 'boolean' }, { key: 'projects.max_projects', kind: 'limit' }] },
  { id: 'people', selectable: true, sellable: true, features: [{ key: 'hr.enabled', kind: 'boolean' }] },
] }
const features = { 'users.limit': 5, 'pmo.enabled': true, 'meetings.enabled': false, 'projects.max_projects': 0, 'hr.enabled': false, 'probe.enabled': true }

describe('vendor entitlement selections', () => {
  it('maps the open booleans onto the release applications', () => {
    expect(entitledSelections(release, features)).toEqual([{ app_id: 'projects', feature_keys: ['pmo.enabled'] }])
    expect(entitledSelections(null, features)).toEqual([])
  })
})
