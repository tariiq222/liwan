import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function load(code: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${code}/${file}`, import.meta.url)), 'utf8'))
}

function leaves(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node }
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...leaves(value, prefix ? `${prefix}.${key}` : key) }), {})
}

describe('my-tasks locale', () => {
  const ar = leaves(load('ar', 'my-tasks.json'))
  const en = leaves(load('en', 'my-tasks.json'))

  it('has identical key sets in ar and en under the myTasks namespace', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(ar).every(key => key.startsWith('myTasks.'))).toBe(true)
  })

  it('has no empty strings and Arabic text in the Arabic file', () => {
    for (const value of [...Object.values(ar), ...Object.values(en)]) expect(value.trim()).not.toBe('')
    for (const value of Object.values(ar)) expect(value).toMatch(/[؀-ۿ]/)
  })

  it('keeps the same placeholders in both locales', () => {
    const tokens = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(ar)) expect(tokens(ar[key]!)).toEqual(tokens(en[key]!))
  })

  it('adds nav.myTasks to common.json in both locales', () => {
    expect((load('ar', 'common.json').nav as Record<string, string>).myTasks).toBe('مهامي الشخصية')
    expect((load('en', 'common.json').nav as Record<string, string>).myTasks).toBe('My to-dos')
  })
})
