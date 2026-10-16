import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TEAM_ROLES } from '../utils/team'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const localesDir = join(appDir, '../i18n/locales')

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`))))
}

const messages = (lang: string) => flatten(JSON.parse(readFileSync(join(localesDir, lang, 'team.json'), 'utf8')) as Tree)

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

const files = sources(appDir)
const text = files.map(file => readFileSync(file, 'utf8')).join('\n')
// Keys written in full, plus the dynamic families the team code builds from a variable.
const literal = new Set([...text.matchAll(/['`](team\.[a-zA-Z.]+)['`]/g)].map(match => match[1]!))
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

describe('team messages', () => {
  const ar = messages('ar')
  const en = messages('en')

  it('has the same keys and placeholders in Arabic and English, none empty', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(ar)) {
      expect(ar[key], key).not.toBe('')
      expect(en[key], key).not.toBe('')
      expect(placeholders(ar[key]!), key).toEqual(placeholders(en[key]!))
    }
  })

  it('names all six roles and every account state in both languages', () => {
    for (const role of TEAM_ROLES) expect(ar[`team.roles.${role}`] && en[`team.roles.${role}`], role).toBeTruthy()
    for (const status of ['enrolling', 'active', 'disabled']) expect(ar[`team.status.${status}`] && en[`team.status.${status}`], status).toBeTruthy()
  })

  it('defines every key written in full, and every key has a reader', () => {
    expect([...literal].filter(key => !(key in ar))).toEqual([])
    const dynamic = ['team.roles.', 'team.status.', 'team.disable.', 'team.reset.', 'team.actions.']
    const unread = Object.keys(ar).filter(key => !literal.has(key) && !dynamic.some(prefix => key.startsWith(prefix)))
    expect(unread).toEqual([])
  })
})
