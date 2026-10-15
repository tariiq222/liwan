// Derives the Storybook auto-import table from Nuxt's own generated
// .nuxt/imports.d.ts and .nuxt/components.d.ts (run `nuxt prepare` first).
// Nothing here is a hand-maintained list of app composables or components.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const webRoot = resolve(here, '..')
const uiRoot = resolve(here, '../../../packages/ui')
// The app and the @nasq/ui layer both contribute components, composables and utils.
const appRoots = [join(webRoot, 'app'), join(uiRoot, 'app')]
const nuxtDir = join(webRoot, '.nuxt')
export const shimPath = join(here, 'nuxt-shims.ts')

// Sources that exist only inside the Nuxt runtime and must be shimmed.
const isNuxtRuntime = (from) => from.startsWith('#app') || from.startsWith('#build') || from.includes('@nuxtjs/i18n/dist/runtime')

function parseExports(file) {
  const text = readFileSync(file, 'utf8')
  const out = []
  for (const m of text.matchAll(/export \{([^}]*)\} from '([^']+)'/g)) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean)
    out.push({ from: m[2], names })
  }
  return out
}

function walk(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (entry === '__tests__' || entry === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, exts, acc)
    else if (exts.some(e => p.endsWith(e))) acc.push(p)
  }
  return acc
}

export async function buildNuxtImports() {
  const shimText = readFileSync(shimPath, 'utf8')
  const shimExports = new Set([
    ...[...shimText.matchAll(/^export (?:async )?(?:function|const|class) (\$?\w+)/gm)].map(m => m[1]),
    ...[...shimText.matchAll(/^export \{([^}]*)\} from/gm)].flatMap(m => m[1].split(',').map(s => s.trim())),
  ])
  const passthrough = []
  const nuxtNames = new Set()
  for (const { from, names } of parseExports(join(nuxtDir, 'imports.d.ts'))) {
    if (isNuxtRuntime(from)) { names.forEach(n => nuxtNames.add(n)); continue }
    // Resolve to the real file so unimport can skip injecting a module's own exports into itself.
    let abs = from
    if (from.startsWith('.')) {
      const base = resolve(nuxtDir, from)
      abs = ['.ts', '.js', '.mjs', '/index.ts'].map(e => base + e).find(existsSync) ?? base
    }
    // unplugin-auto-import already gets Nuxt UI composables from the Nuxt UI plugin.
    if (abs.includes('@nuxt/ui/dist/runtime')) continue
    passthrough.push({ from: abs, imports: names })
  }
  // Report which Nuxt runtime APIs the component tree (components + composables + utils) really uses.
  const src = appRoots.flatMap(root => walk(root, ['.vue', '.ts'])).filter(f => /\/app\/(components|composables|utils|lib)\//.test(f))
  // Comments mention APIs without calling them; scan code only.
  const stripComments = text => text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g, '$1')
  const texts = src.map(f => stripComments(readFileSync(f, 'utf8')))
  const esc = n => n.replace('$', '\\$')
  // A call that is not a locally declared function and not a browser global.
  const used = [...nuxtNames].filter(n => n !== 'setInterval' && texts.some(t =>
    new RegExp(`(^|[^.\\w$])${esc(n)}\\s*[(<]`, 'm').test(t) && !new RegExp(`function ${esc(n)}\\s*\\(`).test(t)))
  const shimmed = used.filter(n => shimExports.has(n))
  const missing = used.filter(n => !shimExports.has(n))
  const shimImports = { from: shimPath, imports: [...nuxtNames].filter(n => shimExports.has(n)) }

  const components = {}
  for (const m of readFileSync(join(nuxtDir, 'components.d.ts'), 'utf8').matchAll(/^export const (\w+): typeof import\("([^"]+)"\)\['default'\]/gm)) {
    const file = resolve(nuxtDir, m[2])
    // App components only: Nuxt UI registers its own Vue-mode U* components (UIcon/ULink differ from the Nuxt ones).
    if (appRoots.some(root => file.startsWith(root))) components[m[1]] = { name: 'default', from: file }
  }
  // Nuxt built-in components the app uses are served from the shim module too.
  for (const name of ['NuxtLink', 'ClientOnly', 'NuxtPage']) if (shimExports.has(name)) components[name] = { name, from: shimPath }
  return { imports: [...passthrough, shimImports], components, report: { nuxtRuntimeNames: nuxtNames.size, used, shimmed, missing, componentCount: Object.keys(components).length } }
}
