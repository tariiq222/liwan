// Discovers the per-pillar locale namespace files from the locale folders.
// Used by nuxt.config.ts (i18n locales) and therefore by Storybook too.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export const LOCALE_CODES = ['ar', 'en'] as const

// common.json always merges first; the other namespaces follow in name order.
function compareNamespaces(a: string, b: string): number {
  if (a === 'common.json') return b === 'common.json' ? 0 : -1
  if (b === 'common.json') return 1
  return a < b ? -1 : a > b ? 1 : 0
}

function listNamespaceFiles(dir: string): string[] {
  return readdirSync(dir).filter(file => file.endsWith('.json')).sort(compareNamespaces)
}

/**
 * Returns `{ ar: ['ar/common.json', ...], en: ['en/common.json', ...] }`, the
 * `files` entries of each Nuxt i18n locale, relative to `localesDir`.
 * Throws when the locales do not ship the same namespace files.
 */
export function discoverLocaleFiles(
  localesDir: string,
  codes: readonly string[] = LOCALE_CODES,
): Record<string, string[]> {
  const names = Object.fromEntries(codes.map(code => [code, listNamespaceFiles(join(localesDir, code))]))
  const [reference, ...others] = codes
  for (const code of others) {
    const expected = new Set(names[reference!])
    const actual = new Set(names[code])
    const missing = [...expected].filter(file => !actual.has(file))
    const extra = [...actual].filter(file => !expected.has(file))
    if (missing.length || extra.length) {
      throw new Error(
        `locale namespace files differ between ${reference} and ${code}: `
        + `missing in ${code}: [${missing.join(', ')}]; extra in ${code}: [${extra.join(', ')}]`,
      )
    }
  }
  return Object.fromEntries(codes.map(code => [code, names[code]!.map(file => `${code}/${file}`)]))
}
