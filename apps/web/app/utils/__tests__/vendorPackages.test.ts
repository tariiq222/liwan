import { describe, expect, it } from 'vitest'
import { packageLimitValue, packageLimitKeys, packageLabel, packageActionBody, packageListReturnTo, packageFormInput, packageMatchesStatus } from '../vendorPackages'

describe('package presentation and editable request contract', () => {
  it('keeps explicit unlimited, zero and bounded quotas distinct', () => {
    expect(packageLimitValue({ mode: 'unlimited', value: '' })).toBeNull()
    expect(packageLimitValue({ mode: 'limited', value: '0' })).toBe(0)
    expect(packageLimitValue({ mode: 'limited', value: '42' })).toBe(42)
    for (const value of ['', '-1', '1.5', '1e3', '1000000001', 'Infinity']) expect(() => packageLimitValue({ mode: 'limited', value })).toThrow()
    expect(() => packageLimitValue({ mode: '', value: '' })).toThrow()
  })
  it('derives only applicable limits from the selected composition', () => {
    expect(packageLimitKeys({ features: ['boolean:hr.enabled'] })).toEqual(['users.limit', 'storage.limit_mb'])
    expect(packageLimitKeys({ features: ['limit:projects.max_projects'] })).toEqual(['users.limit', 'storage.limit_mb', 'projects.max_projects'])
  })
  it('translates known metadata and retains honest unknown labels', () => {
    expect(packageLabel('tier', 'people', key => key)).toBe('vendor.packages.tiers.people')
    expect(packageLabel('module', 'future_module', key => key)).toBe('future_module')
    expect(packageLabel('module', 'nasq_meetings', key => key)).toBe('vendor.packages.apps.meetings')
    expect(packageLabel('module', 'nasq_sales', key => key)).toBe('Sales')
    expect(packageLabel('module', 'customer_acme_reports', key => key)).toBe('Acme reports')
    expect(packageLabel('feature', 'boolean:sales.enabled', key => key)).toBe('boolean:sales.enabled')
    expect(packageLabel('feature', 'boolean:hr.enabled', key => key)).toBe('vendor.packages.features.hr')
  })
  it('sends the optimistic token for lifecycle actions and only reason for clone', () => {
    expect(packageActionBody('publish', 7, ' Review complete ')).toEqual({ revision: 7, reason: 'Review complete' })
    expect(packageActionBody('revisions', 7, 'New offer')).toEqual({ reason: 'New offer' })
    expect(() => packageActionBody('delete', 7, 'x')).toThrow()
  })
  it('accepts only the package list as return destination and preserves filters', () => {
    expect(packageListReturnTo('/vendor/catalog?q=team&status=draft')).toBe('/vendor/catalog?q=team&status=draft')
    for (const url of ['//evil.test', '/vendor/catalog/new', '/vendor/catalog/123/edit', '/vendor/tenants', '/vendor/catalog/../tenants']) expect(packageListReturnTo(url)).toBe('/vendor/catalog')
  })
  it('validates required metadata and emits only editable input with all applicable limits', () => {
    const draft = { name: ' Team ', description: 'Project delivery', catalog_version: '1', catalog_tier: 'projects' }
    const limits = { 'users.limit': { mode: 'limited' as const, value: '0' }, 'storage.limit_mb': { mode: 'unlimited' as const, value: '' }, 'projects.max_projects': { mode: 'limited' as const, value: '5' } }
    expect(packageFormInput(draft, limits, Object.keys(limits)).limits).toEqual({ 'users.limit': 0, 'storage.limit_mb': null, 'projects.max_projects': 5 })
    expect(() => packageFormInput({ ...draft, name: '' }, limits, Object.keys(limits))).toThrow()
    expect(() => packageFormInput(draft, limits, ['unknown.limit'])).toThrow()
  })
})

 it('separates available published offers from withdrawn history', () => {
   expect(packageMatchesStatus({ status: 'published', available: false }, 'published')).toBe(false)
   expect(packageMatchesStatus({ status: 'published', available: false }, 'unavailable')).toBe(true)
   expect(packageMatchesStatus({ status: 'published', available: true }, 'published')).toBe(true)
   expect(packageMatchesStatus({ status: 'draft', available: false }, 'unavailable')).toBe(false)
   expect(packageMatchesStatus({ status: 'draft', available: false }, '')).toBe(true)
 })
