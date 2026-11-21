import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { pluralRules } from '../i18n/pluralRules'

// vue-i18n reads an unescaped `|` as the plural-form separator: a label such as «خط عمودي (|)» is cut at
// the pipe and renders as «خط عمودي (» with the closing bracket gone. The literal must be written as
// `{'|'}` (the same form the locales already use for `{'@'}`). This walks every message in both locales,
// renders it, and fails on the two symptoms: a leftover escape or an unbalanced bracket pair caused by
// the cut. Keys are checked per file so the failure names the file, not a merged namespace.
const localesDir = join(__dirname, '../i18n/locales')

function leaves(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key))
}

function messages(code: 'ar' | 'en') {
  const merged: Record<string, unknown> = {}
  for (const file of readdirSync(join(localesDir, code)).filter(name => name.endsWith('.json'))) {
    Object.assign(merged, JSON.parse(readFileSync(join(localesDir, code, file), 'utf8')))
  }
  return merged
}

describe.each(['ar', 'en'] as const)('literal characters in %s messages', code => {
  const i18n = createI18n({ legacy: false, locale: code, fallbackLocale: code, messages: { [code]: messages(code) } as never, pluralRules })

  it('writes a pipe that survives rendering', () => {
    const rendered = i18n.global.t('hrPayroll.bankProfiles.delimiter.pipe') as string
    expect(rendered).toContain('|')
    expect(rendered).not.toContain("{'|'}")
    // The cut form loses the closing bracket of the pair that held the pipe.
    expect(rendered.match(/\(/g)?.length ?? 0).toBe(rendered.match(/\)/g)?.length ?? 0)
  })

  it('leaves no unescaped plural separator or raw escape in any message', () => {
    const broken: string[] = []
    for (const [path] of leaves(messages(code))) {
      const rendered = i18n.global.t(path, { count: 0, n: 0 }) as string
      if (rendered.includes("{'")) broken.push(`${path}: ${rendered}`)
    }
    expect(broken).toEqual([])
  })
})
