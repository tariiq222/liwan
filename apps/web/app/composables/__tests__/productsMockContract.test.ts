import { describe, expect, it } from 'vitest'
import { CrmPackageListSchema, CrmPackageSchema, ProductPickListSchema } from '@liwan/contracts'
import { crmPreviewData, crmPreviewWrite } from '../../../e2e/crm-ui-preview-data.mjs'
import { productPickPage } from '../../../e2e/products-mock-routes.mjs'

// The mocks of the routes the products service changed answer the shapes of the contracts, so they cannot drift.
const pick = (query = '') => productPickPage(new URL(`http://mock.example.test/api/v1/products/pick${query}`))
const packages = () => CrmPackageListSchema.parse(crmPreviewData('/api/v1/crm/packages', new URL('http://mock.example.test/api/v1/crm/packages?active=all')))

describe('products pick mock', () => {
  it('lists the products with the amounts of one unit, and searches by name', () => {
    const all = ProductPickListSchema.parse(pick())
    expect(all.total).toBe(7)
    expect(all.items[0]).toMatchObject({ id: 1, type: 'service', unit_price: 120, amount_tax: 18, amount_total: 138 })
    expect(ProductPickListSchema.parse(pick('?q=عسل')).items.map(item => item.id)).toEqual([202])
    expect(ProductPickListSchema.parse(pick('?limit=2&offset=1')).items.map(item => item.id)).toEqual([2, 3])
  })
})

describe('CRM packages mock', () => {
  it('adds a product by its id and drops it from the list again', () => {
    crmPreviewWrite('POST', '/api/v1/__mock/reset-crm', {})
    const added = crmPreviewWrite('POST', '/api/v1/crm/packages', { product_id: 3 })!
    expect(CrmPackageSchema.parse(added.body)).toMatchObject({ id: 3, name: 'باقة الأعمال', price: 450 })
    expect(packages().items.map(item => item.id)).toEqual([1, 2, 3])
    expect(crmPreviewWrite('DELETE', '/api/v1/crm/packages/1', {})!.status).toBe(200)
    expect(packages().items.map(item => item.id)).toEqual([2, 3])
  })

  it('refuses what the server refuses and has no patch', () => {
    crmPreviewWrite('POST', '/api/v1/__mock/reset-crm', {})
    expect(crmPreviewWrite('POST', '/api/v1/crm/packages', { product_id: 999 })!.status).toBe(404)
    expect(crmPreviewWrite('POST', '/api/v1/crm/packages', { name: 'x', price: 1 })!.body).toMatchObject({ field: 'product_id' })
    expect(crmPreviewWrite('DELETE', '/api/v1/crm/packages/77', {})!.status).toBe(404)
    expect(crmPreviewWrite('PATCH', '/api/v1/crm/packages/1', { price: 5 })).toBeUndefined()
  })
})
