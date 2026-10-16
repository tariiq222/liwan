import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parse } from '@vue/compiler-sfc'

const roots = ['../apps/web/app/', '../packages/ui/app/', '../packages/commercial-ui/app/'].map(root => fileURLToPath(new URL(root, import.meta.url)))
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? entry.name === '__tests__' ? [] : sources(path.join(dir, entry.name))
    : entry.name.endsWith('.vue') ? [path.join(dir, entry.name)] : [])
}
let failures = 0
const repo = fileURLToPath(new URL('..', import.meta.url))
const files = roots.flatMap(sources)
for (const filename of files) {
  const { errors } = parse(readFileSync(filename, 'utf8'), { filename })
  for (const error of errors) {
    failures++
    console.error(`${path.relative(repo, filename)}: ${typeof error === 'string' ? error : error.message}`)
  }
}
console.log(`Vue template syntax: ${files.length} files, ${failures} errors`)
if (failures) process.exitCode = 1
