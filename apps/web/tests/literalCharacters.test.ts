import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { pluralRules } from '../i18n/pluralRules'

// vue-i18n reads an unescaped `|` as the plural-form separator: a label such as «خط عمودي (|)» is cut at the pipe and
// renders as «خط عمودي (» with the closing bracket gone. The literal must be written as `{'|'}`, the form the locales
// already use for `{'@'}`.
//
// Two checks, both of which fail on that input:
//  1. Every message that contains a pipe in its SOURCE text must survive rendering with the pipe still in it. This is
//     what catches the cut: the rendered form loses everything after the pipe, so a source pipe with no rendered pipe is
//     a message that was split.
//  2. A message must not keep a raw escape in its output (`{'` surviving literally).
// The source text is read per file, not merged, so a key hidden by another file's namespace is still checked.
const localesDir = join(__dirname, '../i18n/locales')

interface Message { file: string, path: string, source: string }

function leaves(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key))
}

/** Every message of a locale, each with the file it came from: two files may own the same path. */
function messages(code: 'ar' | 'en'): Message[] {
  const found: Message[] = []
  for (const file of readdirSync(join(localesDir, code)).filter(name => name.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(localesDir, code, file), 'utf8'))
    for (const [path, source] of leaves(parsed)) found.push({ file, path, source })
  }
  return found
}

/** The messages of one file only, so a key another file shadows is still rendered from its own text. */
const compiled = new Map<string, ReturnType<typeof createI18n>>()

function i18nFor(code: 'ar' | 'en', file: string) {
  const key = `${code}/${file}`
  const cached = compiled.get(key)
  if (cached) return cached
  const own = JSON.parse(readFileSync(join(localesDir, code, file), 'utf8'))
  const instance = createI18n({ legacy: false, locale: code, fallbackLocale: code, messages: { [code]: own } as never, pluralRules })
  compiled.set(key, instance)
  return instance
}

describe.each(['ar', 'en'] as const)('literal characters in %s messages', code => {
  it('keeps a pipe that sits inside a bracket, where it is a character and not a plural separator', () => {
    // A pipe between whole phrases is vue-i18n's plural separator and must be split (133 messages use it that way).
    // A pipe inside a bracket is a character the message shows, and the one the payroll label got wrong.
    const cut: string[] = []
    const insideBrackets = /\([^()]*\|[^()]*\)/
    for (const message of messages(code).filter(entry => insideBrackets.test(entry.source))) {
      const rendered = i18nFor(code, message.file).global.t(message.path) as string
      if (!rendered.includes('|')) cut.push(`${message.file}: ${message.path} → ${JSON.stringify(rendered)}`)
    }
    expect(cut).toEqual([])
  })

  it('leaves no raw escape in any rendered message', () => {
    const broken: string[] = []
    for (const message of messages(code)) {
      const rendered = i18nFor(code, message.file).global.t(message.path, { count: 0, n: 0 }) as string
      if (rendered.includes("{'")) broken.push(`${message.file}: ${message.path} → ${rendered}`)
    }
    expect(broken).toEqual([])
  })

  it('renders the payroll delimiter with its pipe and both brackets', () => {
    const rendered = i18nFor(code, 'hr-payroll.json').global.t('hrPayroll.bankProfiles.delimiter.pipe') as string
    expect(rendered).toContain('|')
    expect(rendered).not.toContain("{'|'}")
    expect(rendered.match(/\(/g)?.length ?? 0).toBe(rendered.match(/\)/g)?.length ?? 0)
  })
})
