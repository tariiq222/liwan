import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The edge guard image copies an explicit list of files (deploy/shared/Dockerfile). A relative import that list misses
// is only found by the image build's import check, twelve minutes into CI; this test finds it in seconds, without Docker.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dockerfile = readFileSync(join(root, 'deploy/shared/Dockerfile'), 'utf8')
// The files the image starts or imports directly: the Dockerfile's own import check, its CMD, HEALTHCHECK and the dedicated start.
const entries = ['deploy/shared/guard.mjs', 'deploy/releases/dedicated_guard.mjs', 'deploy/shared/tiktok-relay.mjs', 'deploy/shared/start.mjs', 'deploy/shared/healthcheck.mjs', 'deploy/releases/start_dedicated.mjs']
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g

/** What a COPY line puts in the image: source path -> directory it lands in. */
function copied() {
  const landed = new Map()
  for (const line of dockerfile.split('\n').filter(text => text.startsWith('COPY '))) {
    const words = line.slice(5).split(/\s+/).filter(word => word && !word.startsWith('--'))
    const destination = words.pop()
    for (const source of words) landed.set(source, destination.replace(/^\.\//, '').replace(/\/$/, ''))
  }
  return landed
}

/** Every repository file the entries reach through relative imports (the only kind native type stripping follows here). */
function closure() {
  const seen = new Set()
  const visit = file => {
    if (seen.has(file)) return
    seen.add(file)
    const source = readFileSync(join(root, file), 'utf8')
    for (const match of source.matchAll(SPECIFIER)) {
      const target = relative(root, resolve(root, dirname(file), match[2]))
      assert.ok(existsSync(join(root, target)), `${file} imports ${match[2]}, which does not exist`)
      visit(target)
    }
  }
  entries.forEach(visit)
  return [...seen].sort()
}

test('the guard image copies every file its entry points reach by relative import, to the same layout', () => {
  const landed = copied()
  const files = closure()
  // The closure must at least be what the image check imports, or the walk is silently empty.
  for (const file of ['deploy/shared/guard.mjs', 'apps/web/server/utils/tenantRegistry.ts', 'apps/web/server/utils/serviceAuthorization.ts']) assert.ok(files.includes(file), file)
  const missing = files.filter(file => landed.get(file) !== dirname(file))
  assert.deepEqual(missing, [], `not copied into the guard image at the same path: ${missing.join(', ')}`)
})

test('the image copies nothing that no entry point reaches', () => {
  const reached = new Set(closure())
  const extra = [...copied().keys()].filter(file => !reached.has(file))
  assert.deepEqual(extra, [], `copied but never imported: ${extra.join(', ')}`)
})
