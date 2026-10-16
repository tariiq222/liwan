import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '..')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

// Nuxt registers components/<dir>/<Name>.vue as <Dir><Name>; the bare <Name> tag renders nothing and Vue only warns.
const componentsRoot = join(appRoot, 'components')
const nested = vueFiles(componentsRoot)
  .map(file => relative(componentsRoot, file).split(sep))
  .filter(parts => parts.length > 1)
  .map(parts => ({ bare: basename(parts.at(-1)!, '.vue'), registered: parts.map(part => part.replace(/\.vue$/, '')).map(part => part[0]!.toUpperCase() + part.slice(1)).join('') }))

describe('component names', () => {
  it('uses the folder-prefixed name for components in a subfolder', () => {
    const offenders = vueFiles(appRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? ''
      return nested
        .filter(({ bare, registered }) => bare !== registered && new RegExp(`<${bare}[\\s/>]`).test(template) && !new RegExp(`import\\s+${bare}\\b`).test(source))
        .map(({ bare, registered }) => `${relative(appRoot, file)}: <${bare}> should be <${registered}>`)
    })
    expect(offenders).toEqual([])
  })
})
