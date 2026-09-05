import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'

// Rebuild the standalone guide with the app's colour policy. No network access.
// Run from any directory: node docs/design-system/build.mjs
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const source = await readFile(resolve(root, 'apps/web/app/utils/brandTheme.ts'), 'utf8')
const parsed = ts.createSourceFile('brandTheme.ts', source, ts.ScriptTarget.Latest, true)
const names = []
let defaultPrimary
for (const node of parsed.statements) {
  if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
    throw new Error('Guide colour utility must be self-contained, with named declarations only')
  }
  if (!ts.canHaveModifiers(node) || !ts.getModifiers(node)?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue
  if (ts.isFunctionDeclaration(node) && node.name) {
    names.push(node.name.text)
  } else if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) throw new Error('Unsupported colour utility export')
      names.push(declaration.name.text)
      if (declaration.name.text === 'DEFAULT_PRIMARY' && declaration.initializer && ts.isStringLiteral(declaration.initializer)) {
        defaultPrimary = declaration.initializer.text
      }
    }
  } else {
    throw new Error('Unsupported colour utility export')
  }
}
if (names.sort().join(',') !== 'DEFAULT_PRIMARY,createBrandTheme' || !/^#[0-9a-f]{6}$/i.test(defaultPrimary ?? '')) {
  throw new Error('Expected DEFAULT_PRIMARY hex literal and createBrandTheme exports')
}
const result = ts.transpileModule(source.replace(/^export /gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  reportDiagnostics: true,
})
if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) {
  throw new Error('Colour utility compilation failed')
}
const compiled = result.outputText.replace(/<\/script/gi, '<\\/script')
const htmlPath = resolve(here, 'Components.html')
const html = await readFile(htmlPath, 'utf8')
const begin = '/* BEGIN GENERATED BRAND THEME */'
const end = '/* END GENERATED BRAND THEME */'
const region = /\/\* BEGIN GENERATED BRAND THEME \*\/[\s\S]*?\/\* END GENERATED BRAND THEME \*\//
if (html.split(begin).length !== 2 || html.split(end).length !== 2 || !region.test(html)) {
  throw new Error('Guide must contain exactly one complete theme region')
}
const previousDefault = html.match(/const DEFAULT='(#[0-9a-f]{6})'/i)?.[1]
if (!previousDefault) throw new Error('Guide default marker is missing')
// Neutral text is not a brand default, even when its initial hex is identical.
const neutralForeground = html.match(/--fg:(#[0-9a-f]{6})/i)?.[1]
let updated = html.replaceAll(previousDefault, defaultPrimary)
  .replace(region, () => `${begin}\n${compiled}\n${end}`)
if (neutralForeground) updated = updated.replace(/--fg:#[0-9a-f]{6}/i, `--fg:${neutralForeground}`)
const defaults = runInNewContext(`${result.outputText};createBrandTheme(DEFAULT_PRIMARY)`, {}, { timeout: 1000 })
for (const [key, value] of Object.entries(defaults)) {
  if (!/^--[a-z-]+$/.test(key) || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Invalid generated theme token')
  updated = updated.replace(new RegExp(`${key}:#[0-9a-f]{6}(?=;)`, 'i'), `${key}:${value}`)
}
const temporary = `${htmlPath}.tmp-${process.pid}`
await writeFile(temporary, updated)
await rename(temporary, htmlPath)
await mkdir(resolve(here, 'fonts'), { recursive: true })
for (const name of ['IBMPlexSansArabic-Regular.woff2', 'IBMPlexSansArabic-SemiBold.woff2', 'LICENSE.txt']) {
  await copyFile(resolve(root, 'apps/web/public/fonts', name), resolve(here, 'fonts', name))
}
console.log('Guide rebuilt atomically using the app brandTheme.ts colour policy.')
