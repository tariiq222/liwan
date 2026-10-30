import { describe, expect, it } from 'vitest'
import arOperations from '../../../../i18n/locales/ar/operations.json'
import enOperations from '../../../../i18n/locales/en/operations.json'
import manifest from '../manifest'
import { operationBellHref, operationBellTitle } from '../bell'

// A minimal vue-i18n: dotted keys into the locale file, `{name}` placeholders replaced.
const translator = (messages: object) => (key: string, named: Record<string, unknown> = {}) => {
  const message = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages)
  if (typeof message !== 'string') throw new Error(`missing key ${key}`)
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(named[name]))
}

const row = (kind: string) => ({ id: 1, kind, request_id: 5, title: 'Laptop', created_at: '2026-10-29T09:00:00Z', is_read: false })

describe('operations bell rows', () => {
  it('words every kind in Arabic and English with the request name', () => {
    const ar = translator(arOperations)
    const en = translator(enOperations)
    expect(operationBellTitle(row('operations.review_requested'), ar)).toBe('طلب بانتظار مراجعتك: Laptop')
    expect(operationBellTitle(row('operations.approved'), ar)).toBe('تم اعتماد طلبك: Laptop')
    expect(operationBellTitle(row('operations.rejected'), ar)).toBe('تم رفض طلبك: Laptop')
    expect(operationBellTitle(row('operations.returned'), ar)).toBe('أُعيد طلبك للتعديل: Laptop')
    expect(operationBellTitle(row('operations.review_requested'), en)).toBe('A request is waiting for your review: Laptop')
    expect(operationBellTitle(row('operations.approved'), en)).toBe('Your request was approved: Laptop')
    expect(operationBellTitle(row('operations.rejected'), en)).toBe('Your request was refused: Laptop')
    expect(operationBellTitle(row('operations.returned'), en)).toBe('Your request was returned for changes: Laptop')
  })

  it('falls back to the plain title for a row that breaks the contract', () => {
    expect(operationBellTitle({ ...row('operations.approved'), request_id: null }, translator(enOperations))).toBe('Laptop')
  })

  it('opens the request page and is declared by the manifest', () => {
    expect(operationBellHref(row('operations.approved'))).toBe('/operations/5')
    expect(operationBellHref({ kind: 'operations.approved' })).toBeNull()
    expect(manifest.bell?.kinds).toHaveLength(4)
  })
})
