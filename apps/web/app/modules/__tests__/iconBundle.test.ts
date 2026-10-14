import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Icons run with provider 'none' and no API fallback: an `i-lucide-*` name is only
// rendered when nuxt.config's icon scan reads the file that declares it.
const webRoot = join(__dirname, '..', '..', '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (name === '__tests__') return []
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const rest = glob.slice(i)
    if (rest.startsWith('**/')) { source += '(?:.*/)?'; i += 2 }
    else if (glob[i] === '*') source += '[^/]*'
    else if (glob[i] === '{') source += '(?:'
    else if (glob[i] === '}') source += ')'
    else if (glob[i] === ',') source += '|'
    else source += glob[i]!.replace(/[.+?^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

function scanGlobs(): RegExp[] {
  const config = readFileSync(join(webRoot, 'nuxt.config.ts'), 'utf8')
  const match = config.match(/globInclude:\s*\[([^\]]*)\]/)
  expect(match, 'nuxt.config.ts declares icon.clientBundle.scan.globInclude').toBeTruthy()
  return [...match![1]!.matchAll(/'([^']+)'/g)].map(item => globToRegExp(item[1]!))
}

describe('icon bundle scan', () => {
  it('covers every file under app/modules that declares an i-lucide icon', () => {
    const globs = scanGlobs()
    const declaring = walk(join(webRoot, 'app', 'modules'))
      .filter(file => /i-lucide-[a-z0-9-]+/.test(readFileSync(file, 'utf8')))
      .map(file => relative(webRoot, file))
    expect(declaring.length).toBeGreaterThan(0)
    const missed = declaring.filter(file => !globs.some(glob => glob.test(file)))
    expect(missed).toEqual([])
  })
})
