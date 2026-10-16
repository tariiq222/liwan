import { describe, expect, it } from 'vitest'
import { CLIENT_STATE_FILTERS, CUSTOMER_TABS, TENANT_TABS, clientListQuery, clientTab, clientTabItems, clientTo, isClientStateFilter } from '../vendorClients'

describe('client list query', () => {
  it('drops "all", an empty search and the first page', () => {
    expect(clientListQuery({ q: '', state: 'all', page: 1 })).toEqual({ q: undefined, state: undefined, page: undefined })
    expect(clientListQuery({ q: 'acme', state: 'no_workspace', page: 3 })).toEqual({ q: 'acme', state: 'no_workspace', page: 3 })
  })
  it('accepts the customer states and the two workspace states only', () => {
    expect(CLIENT_STATE_FILTERS).toEqual(['all', 'awaiting_payment', 'activating', 'active', 'failed', 'inactive', 'setup_required', 'no_workspace', 'no_commercial'])
    expect(isClientStateFilter('no_commercial')).toBe(true)
    expect(isClientStateFilter('bogus')).toBe(false)
    expect(isClientStateFilter(undefined)).toBe(false)
  })
})

describe('client row link', () => {
  it('opens the customer page when there is a customer, else the workspace page', () => {
    expect(clientTo({ customer_id: 'c/1', tenant_id: 't-1' }, '/customers?q=a')).toEqual({ path: '/customers/c%2F1', query: { returnTo: '/customers?q=a' } })
    expect(clientTo({ customer_id: null, tenant_id: 't-1' }, '/customers')).toEqual({ path: '/tenants/t-1', query: { returnTo: '/customers' } })
  })
})

describe('record tabs', () => {
  it('names the six customer tabs and the three workspace tabs', () => {
    expect(CUSTOMER_TABS).toEqual(['summary', 'subscription', 'invoices', 'workspace', 'operations', 'history'])
    expect(TENANT_TABS).toEqual(['summary', 'workspace', 'operations'])
  })
  it('reads the tab from the URL, only when the page offers it', () => {
    expect(clientTab('history', CUSTOMER_TABS)).toBe('history')
    expect(clientTab(['workspace', 'history'], CUSTOMER_TABS)).toBe('workspace')
    expect(clientTab('history', TENANT_TABS)).toBe('summary')
    expect(clientTab('invoices', CUSTOMER_TABS.filter(tab => tab !== 'invoices'))).toBe('summary')
    expect(clientTab(undefined, CUSTOMER_TABS)).toBe('summary')
  })
  it('builds links that keep the other query keys and leave the summary without a tab', () => {
    const items = clientTabItems(TENANT_TABS, 'workspace', { path: '/tenants/t-1', query: { returnTo: '/customers' } }, tab => tab.toUpperCase(), 'tenant-tab')
    expect(items.map(item => [item.key, item.label, item.active])).toEqual([['tenant-tab-summary', 'SUMMARY', false], ['tenant-tab-workspace', 'WORKSPACE', true], ['tenant-tab-operations', 'OPERATIONS', false]])
    expect(items[0]!.to).toEqual({ path: '/tenants/t-1', query: { returnTo: '/customers', tab: undefined } })
    expect(items[2]!.to).toEqual({ path: '/tenants/t-1', query: { returnTo: '/customers', tab: 'operations' } })
  })
})
