import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS, AUDIT_OPERATION_STATUSES, AUDIT_OPERATION_TYPES } from '@liwan/commercial-contracts'
import { auditActionParts } from '../utils/vendorAudit'

const vendor = (lang: 'ar' | 'en') => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../i18n/locales/${lang}/vendor.json`), 'utf8')).vendor
const at = (tree: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), tree)
const leaves = (tree: Record<string, unknown>, prefix = ''): string[] => Object.entries(tree).flatMap(([key, value]) => (value && typeof value === 'object' ? leaves(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`]))

// The canonical list lives in @liwan/commercial-contracts (the console may import only that from the commercial side);
// the control plane test audit-actions.test.ts fails when a source file writes an action missing from it.
describe.each(['ar', 'en'] as const)('audit action texts (%s)', lang => {
  const strings = vendor(lang)
  it('has a text for every action the control plane writes', () => {
    const missing = AUDIT_ACTIONS.filter(action => typeof at(strings.audit.actions, action) !== 'string' || !(at(strings.audit.actions, action) as string).trim())
    expect(missing).toEqual([])
  })
  it('has no text for an action nobody writes', () => {
    expect(leaves(strings.audit.actions).filter(key => !(AUDIT_ACTIONS as readonly string[]).includes(key))).toEqual([])
  })
  it('does not promise an e-mail search: the control plane matches display names only', () => {
    expect(strings.audit.actorPlaceholder).not.toMatch(/mail|بريد/i)
  })
  it('reads every operation event from its type and status texts', () => {
    for (const type of AUDIT_OPERATION_TYPES) for (const status of AUDIT_OPERATION_STATUSES) {
      const parts = auditActionParts(`operation.${type}.${status}`)
      expect(parts, `${type} ${status}`).toEqual({ type, status })
      expect(at(strings.operations.types, type), `operations.types.${type}`).toBeTruthy()
      expect(at(strings.status, status), `status.${status}`).toBeTruthy()
    }
  })
})
