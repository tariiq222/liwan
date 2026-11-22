import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A locale key that a component reads and no file defines renders as the raw path on screen: the user sees
// `nav.panel.retry` instead of «إعادة المحاولة». That happened when a cleanup removed a key by name and three panel
// components still asked for it, so this walks the components and checks each `t('…')` against the merged messages.
//
// It reads the merged set the way the application does (every namespace file, later files winning), so it answers the
// question the browser answers: does this key resolve?
const appRoot = resolve(import.meta.dirname, '..')
const localesRoot = join(appRoot, 'i18n/locales')
// The shared layers' messages are merged in before the application's, which is the order the runtime uses: a component
// in apps/web may read `app.cancel` or `errors.generic`, owned by packages/ui, or `commercial.invoice.number`, owned by
// packages/commercial-ui. The list follows `extends` in nuxt.config.ts.
const layerRoots = ['ui', 'commercial-ui'].map(name => resolve(appRoot, `../../packages/${name}/i18n/locales`))

/** A deep merge, the way @nuxtjs/i18n combines the namespace files: a shallow Object.assign would drop a whole `app`
 *  object for every file that owns one, which is not what the browser sees. */
function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
      mergeInto(current as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      target[key] = value
    }
  }
}

function merge(dir: string, code: 'ar' | 'en', into: Record<string, unknown>) {
  for (const file of readdirSync(join(dir, code)).filter(name => name.endsWith('.json'))) {
    mergeInto(into, JSON.parse(readFileSync(join(dir, code, file), 'utf8')))
  }
}

function messages(code: 'ar' | 'en'): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const layerRoot of layerRoots) merge(layerRoot, code, merged)
  merge(localesRoot, code, merged)
  return merged
}

/** The path a key resolves to in the merged messages, or undefined. */
function resolveKey(tree: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree)
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

/**
 * Literal keys a file asks for. A template literal with an interpolation (`noWindowByKind.${kind}`) cannot be resolved
 * statically; those are skipped, and the interpolation's own object is checked by a test where it matters.
 */
function literalKeys(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) found.add(match[1]!)
  return [...found]
}

describe.each(['ar', 'en'] as const)('%s messages resolve every literal key its components read', code => {
  it('has no raw key on screen from a missing message', () => {
    const tree = messages(code)
    const missing: string[] = []
    for (const file of sourceFiles(join(appRoot, 'app'))) {
      for (const key of literalKeys(readFileSync(file, 'utf8'))) {
        if (resolveKey(tree, key) === undefined) missing.push(`${file.slice(appRoot.length + 1)}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
