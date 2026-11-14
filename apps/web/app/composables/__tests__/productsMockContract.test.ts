import { beforeEach, describe, expect, it } from 'vitest'
import {
  CrmPackageListSchema, CrmPackageSchema, ProductListSchema, ProductPickListSchema, ProductSchema, ProductSettingsSchema, ProductTaxChoiceListSchema,
} from '@liwan/contracts'
import { crmPreviewData, crmPreviewWrite } from '../../../e2e/crm-ui-preview-data.mjs'
import { handleProducts, productPickPage } from '../../../e2e/products-mock-routes.mjs'

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

// The stub answers HTTP requests: a fake request and response give each call its status and body.
async function call(method: string, path: string, body?: object, cookie = ''): Promise<{ status: number; body: unknown }> {
  let answer: { status: number; body: unknown } | undefined
  const url = new URL(`http://mock.example.test${path}`)
  const handled = await handleProducts(
    { method, headers: { cookie } },
    {},
    url.pathname,
    url,
    { json: (_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload } }, readBody: async () => JSON.stringify(body ?? {}) },
  )
  expect(handled).toBe(true)
  return answer as { status: number; body: unknown }
}

describe('products mock', () => {
  beforeEach(async () => { await call('POST', '/api/v1/__mock/reset-products') })

  it('lists products by name, type, archived state and page, all in the contract shape', async () => {
    const all = ProductListSchema.parse((await call('GET', '/api/v1/products')).body)
    expect(all.total).toBe(7)
    expect(all.items[0]).toMatchObject({ id: 1, company: null, list_price: 120, price: { amount_untaxed: 120, amount_tax: 18, amount_total: 138 } })
    expect(ProductListSchema.parse((await call('GET', '/api/v1/products?q=عسل')).body).items.map(item => item.id)).toEqual([202])
    expect(ProductListSchema.parse((await call('GET', '/api/v1/products?type=service')).body).items.map(item => item.id)).toEqual([1, 2, 3])
    expect(ProductListSchema.parse((await call('GET', '/api/v1/products?archived=true')).body).items.map(item => item.id)).toEqual([205])
    expect(ProductListSchema.parse((await call('GET', '/api/v1/products?limit=2&offset=1')).body).items.map(item => item.id)).toEqual([2, 3])
    expect((await call('GET', '/api/v1/products?type=combo')).body).toMatchObject({ code: 'invalid', field: 'type' })
  })

  it('answers a product with its taxes, and none of them for an establishment that is not registered', async () => {
    expect(ProductSchema.parse((await call('GET', '/api/v1/products/202')).body).taxes?.map(tax => tax.id)).toEqual([11, 12])
    const bare = ProductSchema.parse((await call('GET', '/api/v1/products/1', undefined, 'mock_products=untaxed')).body)
    expect(bare.taxes).toBeUndefined()
    expect(bare.price).toMatchObject({ amount_tax: 0, amount_total: 120 })
    expect((await call('GET', '/api/v1/products/999')).status).toBe(404)
  })

  it('creates, edits, archives and restores a product, and the pick list follows', async () => {
    const created = await call('POST', '/api/v1/products', { name: ' جلسة ', type: 'service', list_price: 200, taxes: [12], image: { name: 'a.png', mimetype: 'image/png', data: 'AAAA' } })
    expect(created.status).toBe(201)
    expect(ProductSchema.parse(created.body)).toMatchObject({ name: 'جلسة', has_image: true, company: null, taxes: [{ id: 12 }], price: { amount_total: 200 } })
    const { id } = created.body as { id: number }
    expect(ProductSchema.parse((await call('PATCH', `/api/v1/products/${id}`, { list_price: 100, image: null })).body)).toMatchObject({ list_price: 100, has_image: false })
    expect(ProductSchema.parse((await call('POST', `/api/v1/products/${id}/archive`)).body).active).toBe(false)
    expect(ProductPickListSchema.parse((await call('GET', '/api/v1/products/pick')).body).items.map(item => item.id)).not.toContain(id)
    expect(ProductSchema.parse((await call('POST', `/api/v1/products/${id}/restore`)).body).active).toBe(true)
    expect(ProductPickListSchema.parse((await call('GET', '/api/v1/products/pick')).body).items.map(item => item.id)).toContain(id)
  })

  it('refuses what the server refuses', async () => {
    expect((await call('POST', '/api/v1/products', { type: 'service' })).body).toMatchObject({ field: 'name' })
    expect((await call('POST', '/api/v1/products', { name: 'x', type: 'combo' })).body).toMatchObject({ field: 'type' })
    expect((await call('POST', '/api/v1/products', { name: 'x', type: 'goods', list_price: -1 })).body).toMatchObject({ field: 'list_price' })
    expect((await call('POST', '/api/v1/products', { name: 'x', type: 'goods', image: { name: 'a.gif', mimetype: 'image/gif', data: 'AAAA' } })).body).toMatchObject({ field: 'image' })
    expect((await call('POST', '/api/v1/products', { name: 'x', type: 'goods', taxes: [999] })).body).toMatchObject({ field: 'taxes' })
    expect((await call('POST', '/api/v1/products', { name: 'x', type: 'goods', taxes: [11] }, 'mock_products=untaxed')).body).toMatchObject({ field: 'taxes' })
    expect((await call('POST', '/api/v1/products', { name: 'x', type: 'goods', colour: 'red' })).body).toMatchObject({ code: 'unknown_field' })
    expect((await call('PATCH', '/api/v1/products/1', {})).status).toBe(422)
  })

  it('answers 403 with the D23 reason, and splits the definition from the price by capability', async () => {
    expect((await call('PATCH', '/api/v1/products/203', { name: 'y' })).body).toMatchObject({ code: 'forbidden', details: { reason: 'managed_in_branch' } })
    expect((await call('POST', '/api/v1/products/203/archive')).body).toMatchObject({ details: { reason: 'managed_in_branch' } })
    expect((await call('PATCH', '/api/v1/products/1', { name: 'y' }, 'mock_products=refuse')).body).toMatchObject({ details: { reason: 'managed_in_root_company' } })
    const reader = 'mock_caps=reader'
    expect((await call('PATCH', '/api/v1/products/1', { list_price: 5 }, reader)).status).toBe(403)
    expect((await call('POST', '/api/v1/products', { name: 'x', type: 'goods' }, reader)).status).toBe(403)
  })

  it('offers the tax choices, none for an establishment that is not registered', async () => {
    const choices = ProductTaxChoiceListSchema.parse((await call('GET', '/api/v1/products/taxes')).body)
    expect(choices.items.map(choice => [choice.id, choice.active])).toEqual([[11, true], [12, true], [13, false]])
    expect(ProductTaxChoiceListSchema.parse((await call('GET', '/api/v1/products/taxes', undefined, 'mock_products=untaxed')).body).total).toBe(0)
  })

  it('keeps the settings revision, and refuses a change of sharing while products exist', async () => {
    expect(ProductSettingsSchema.parse((await call('GET', '/api/v1/products/settings')).body)).toMatchObject({ sharing: 'establishment', can_manage: true, revision: 1 })
    expect(ProductSettingsSchema.parse((await call('GET', '/api/v1/products/settings', undefined, 'mock_products=branch')).body).can_manage).toBe(false)
    expect((await call('PATCH', '/api/v1/products/settings', { sharing: 'branch', revision: 9 })).body).toMatchObject({ code: 'conflict' })
    expect((await call('PATCH', '/api/v1/products/settings', { sharing: 'branch', revision: 1 })).body).toMatchObject({ code: 'sharing_transfer_required', field: 'sharing' })
    expect(ProductSettingsSchema.parse((await call('PATCH', '/api/v1/products/settings', { sharing: 'establishment', revision: 1 })).body).revision).toBe(2)
    expect((await call('PATCH', '/api/v1/products/settings', { sharing: 'branch', revision: 2 }, 'mock_products=branch')).status).toBe(403)
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
