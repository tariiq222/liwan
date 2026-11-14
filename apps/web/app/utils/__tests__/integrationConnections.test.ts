import type { IntegrationConnection, IntegrationConnectionList } from '@liwan/contracts'
import { describe, expect, it } from 'vitest'
import { dropConnection, storeConnection, typedValues } from '../integrationConnections'

const connection = (id: number, extra: Partial<IntegrationConnection> = {}): IntegrationConnection => ({
  ref: `connection:${id}`, id, provider: 'meta', auth: 'keys', external_id: String(id), label: '', app_id: null, state: 'connected',
  status_message: '', last_checked: null, token_expires_at: null, secrets: [], used_by: [], webhooks: [], settings_path: null, ...extra,
})
const list = (...items: IntegrationConnection[]): IntegrationConnectionList => ({ items, total: items.length })

describe('storeConnection', () => {
  it('replaces the connection with the server answer and keeps the order and total', () => {
    const next = storeConnection(list(connection(1), connection(2)), connection(2, { state: 'error' }))
    expect(next?.items.map(item => [item.id, item.state])).toEqual([[1, 'connected'], [2, 'error']])
    expect(next?.total).toBe(2)
  })

  it('appends a connection the list has not seen and leaves an unloaded list alone', () => {
    expect(storeConnection(list(connection(1)), connection(5))).toMatchObject({ total: 2, items: [{ id: 1 }, { id: 5 }] })
    expect(storeConnection(undefined, connection(5))).toBeUndefined()
  })
})

describe('dropConnection', () => {
  it('removes the connection and lowers the total once', () => {
    expect(dropConnection(list(connection(1), connection(2)), 'connection:1')).toMatchObject({ total: 1, items: [{ id: 2 }] })
    expect(dropConnection(list(connection(1)), 'connection:9')).toMatchObject({ total: 1 })
  })
})

describe('typedValues', () => {
  it('keeps only what was typed, trimmed', () => {
    expect(typedValues({ a: ' x ', b: '  ', c: '' })).toEqual({ a: 'x' })
  })
})
