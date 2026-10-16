import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { adminNav } from '../utils/adminNav'

type Tree = { [key: string]: string | Tree }
const load = (locale: string): Tree => JSON.parse(readFileSync(new URL(`../../i18n/locales/${locale}/app.json`, import.meta.url), 'utf8'))
const leaves = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`)))
const lookup = (tree: Tree, path: string): unknown => path.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree)

const ALL_CAPABILITIES = ['vendor.read', 'vendor.billing.manage', 'vendor.audit.read', 'vendor.accounts.manage']
const ROLE_KEYS = ['owner', 'customer_success', 'finance', 'product', 'operations', 'support']

describe('shell locale keys', () => {
  it('ships the same keys in Arabic and English', () => {
    expect(leaves(load('en')).sort()).toEqual(leaves(load('ar')).sort())
  })

  it.each(['ar', 'en'])('names every section and role in %s', (locale) => {
    const tree = load(locale)
    for (const item of adminNav(ALL_CAPABILITIES)) expect(lookup(tree, item.labelKey), item.labelKey).toBeTypeOf('string')
    for (const role of ROLE_KEYS) expect(lookup(tree, `app.shell.roles.${role}`), role).toBeTypeOf('string')
  })
})
