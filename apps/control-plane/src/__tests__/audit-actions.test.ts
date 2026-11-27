import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS, AUDIT_OPERATION_STATUSES, AUDIT_OPERATION_TYPES } from '@liwan/commercial-contracts'

// Every action written to `audit_events` has a text in the vendor console (apps/vendor-admin auditActionsLocale.test.ts reads the same
// list). This test reads the source: an action literal at a place that writes an audit row, and absent from AUDIT_ACTIONS, fails.
const sourceRoot = join(import.meta.dirname, '..')
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'migrations' || entry.name === 'helpers' ? [] : files(path)
  return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
})
const LITERAL = /['"`]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"`]/g
// Next to an audit write, a literal can also be a capability or an outbox kind: these are not actions.
const NOT_ACTIONS = new Set(['billing.notice', 'free_base.locked', 'subscription.manage', 'vendor.subscriptions.manage'])
const known = new Set<string>(AUDIT_ACTIONS)
// The actions built from a variable (`plan.${action}`, `catalog.${action}`) and the operation events have no literal to find.
const BUILT = /^(?:plan|bundle|catalog)\.(?:edit|validate|publish|withdraw|restore)$|^operation\./

function actionsWrittenIn(source: string): string[] {
  const windows: string[] = []
  for (const match of source.matchAll(/INSERT INTO audit_events/g)) windows.push(source.slice(match.index, match.index + 700))
  for (const match of source.matchAll(/\b(?:audit|audited|writeAudit)\(/g)) windows.push(source.slice(match.index, match.index + 240))
  for (const match of source.matchAll(/^.*(?:_ACTION\b|\baction:).*$/gm)) windows.push(match[0])
  return windows.flatMap(text => [...text.matchAll(LITERAL)].map(literal => literal[1]!)).filter(action => !action.startsWith('vendor.') && !NOT_ACTIONS.has(action))
}

describe('audit actions', () => {
  const sources = files(sourceRoot).map(path => ({ path: relative(sourceRoot, path), text: readFileSync(path, 'utf8') }))

  it('lists every action a source file writes', () => {
    const unlisted = sources.flatMap(({ path, text }) => [...new Set(actionsWrittenIn(text))].filter(action => !known.has(action)).map(action => `${path}: ${action}`))
    expect(unlisted).toEqual([])
  })

  it('lists no action that no source file writes', () => {
    const everything = sources.map(source => source.text).join('\n')
    expect(AUDIT_ACTIONS.filter(action => !BUILT.test(action) && !everything.includes(`'${action}'`) && !everything.includes(`"${action}"`) && !everything.includes(`\`${action}\``))).toEqual([])
  })

  it('writes operation events for the listed types and statuses', () => {
    const worker = sources.find(source => source.path === 'worker.ts')!.text
    expect(worker).toContain('`operation.${type}.${status}`')
    expect(sources.find(source => source.path === 'http.ts')!.text).toContain('`operation.${kind}.queued`')
    expect(AUDIT_OPERATION_TYPES).toContain('tenant.create')
    expect(AUDIT_OPERATION_STATUSES).toContain('queued')
  })
})
