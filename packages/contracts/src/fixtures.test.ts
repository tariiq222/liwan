/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import * as contracts from './index'

// Real Odoo responses recorded by `python3 -B tools/contract_fixtures.py`; every one must parse
// with the strict zod schema the manifest names, so a serializer/contract drift fails here.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const manifest: { fixtures: { name: string, route: string, schema: string }[] } =
  JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'))
const schemas = contracts as unknown as Record<string, ZodType | undefined>

function issuesOf(name: string, schema: string) {
  const parser = schemas[schema]
  expect(parser, `${schema} is not exported by the contracts package`).toBeDefined()
  const result = parser!.safeParse(JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8')))
  return result.success ? [] : result.error.issues
}

describe('contract fixtures', () => {
  it('has one file on disk for every manifest entry and no other', () => {
    const onDisk = (readdirSync(fixtureDir, { recursive: true }) as string[])
      .filter(file => file.endsWith('.json') && file !== 'manifest.json')
      .map(file => file.replace(/\\/g, '/').replace(/\.json$/, ''))
    expect(onDisk.sort()).toEqual(manifest.fixtures.map(({ name }) => name).sort())
  })

  for (const { name, route, schema } of manifest.fixtures) {
    it(`${name} (${route}) parses with ${schema}`, () => {
      expect(issuesOf(name, schema)).toEqual([])
    })
  }
})
