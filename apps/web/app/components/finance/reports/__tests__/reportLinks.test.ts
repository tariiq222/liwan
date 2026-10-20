import { describe, expect, it } from 'vitest'
import { accountToggleTo } from '../reportLinks'

const route = { path: '/finance/reports/analytic', query: { date_from: '2026-10-01', account_id: '3', page: '2' } }

describe('the link that opens an account under its row', () => {
  it('opens another account on its first page and keeps the other filters', () => {
    expect(accountToggleTo(route, 7, 3)).toEqual({ path: route.path, query: { date_from: '2026-10-01', account_id: '7' } })
    expect(accountToggleTo({ ...route, query: { date_from: '2026-10-01' } }, 7, null)).toEqual({ path: route.path, query: { date_from: '2026-10-01', account_id: '7' } })
  })

  it('closes the open account', () => {
    expect(accountToggleTo(route, 3, 3).query).toEqual({ date_from: '2026-10-01' })
  })
})
