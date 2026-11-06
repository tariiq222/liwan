import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AuditActionSchema } from '../access'

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url))
const ADDONS = ['liwan_core', 'liwan_api', 'liwan_access_hr']
/** The call that writes an access-log entry, and the company helper that forwards its first argument to it. */
const LOG_CALL = /_liwan_log(?:_company_change)?\(/g
const ACTION_LITERAL = /'([a-z_]+\.[a-z_]+)'/g

const pythonSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'tests' ? [] : pythonSources(path)
    return name.endsWith('.py') ? [path] : []
  })

/** The action strings among the first argument of every log call: the text up to its first top-level comma. */
const loggedActions = (source: string): string[] => {
  const actions: string[] = []
  for (const match of source.matchAll(LOG_CALL)) {
    let depth = 0
    let end = match.index + match[0].length
    for (; end < source.length; end++) {
      const char = source[end]
      if (char === '(' || char === '[' || char === '{') depth++
      else if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) break
        depth--
      } else if (char === ',' && depth === 0) break
    }
    const argument = source.slice(match.index + match[0].length, end)
    actions.push(...[...argument.matchAll(ACTION_LITERAL)].map(literal => literal[1]!))
  }
  return actions
}

describe('access log actions', () => {
  it('lists every action the Odoo addons log in the contract enum', () => {
    const logged = new Set(ADDONS.flatMap(addon =>
      pythonSources(join(REPO, 'odoo-addons', addon)).flatMap(path => loggedActions(readFileSync(path, 'utf8'))),
    ))
    expect(logged.size).toBeGreaterThan(15)
    expect([...logged].filter(action => !AuditActionSchema.options.includes(action as never))).toEqual([])
  })
})
