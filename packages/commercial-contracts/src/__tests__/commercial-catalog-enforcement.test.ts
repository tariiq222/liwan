import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogApplicationsFromSolution, enforcementRefs } from '../commercial/catalog.js'

const v3Solution = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform_v3.json', import.meta.url), 'utf8'))

describe('catalog enforcement references', () => {
  it('keeps the explicit entries unchanged', () => {
    expect(enforcementRefs('pmo.enabled')).toEqual(['liwan_api.requires_feature:pmo.enabled'])
    expect(enforcementRefs('projects.max_projects')).toEqual(['liwan_pmo.project_project._liwan_claim_projects'])
    expect(enforcementRefs('users.limit')).toEqual(['liwan_platform.res_users.users.limit'])
  })

  it('derives the shared feature check for an application enabled key without an entry', () => {
    expect(enforcementRefs('sales.enabled')).toEqual(['liwan_api.requires_feature:sales.enabled'])
    expect(enforcementRefs('sales.max_orders')).toEqual([])
    expect(enforcementRefs('enabled')).toEqual([])
  })

  it('applies the derivation to a new tier of the release solution', () => {
    const solution = structuredClone(v3Solution)
    solution.tiers.push({ id: 'sales', name: 'Sales', modules: ['liwan_sales'], features: ['boolean:sales.enabled'] })
    const sales = catalogApplicationsFromSolution(solution, 'v1').find(app => app.id === 'sales')
    expect(sales?.features.find(feature => feature.key === 'sales.enabled')?.enforcement_refs)
      .toEqual(['liwan_api.requires_feature:sales.enabled'])
  })
})
