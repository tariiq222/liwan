import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadMigrations } from '../db.js'

const directories: string[] = []

/** A migrations folder holding the named files, each with its own name as its body. */
async function folder(...names: string[]): Promise<URL> {
  const directory = await mkdtemp(join(tmpdir(), 'liwan-migrations-'))
  directories.push(directory)
  for (const name of names) await writeFile(join(directory, name), name)
  return pathToFileURL(`${directory}/`)
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('loadMigrations', () => {
  it('loads the real folder as versions 1 to N ascending, without 40 and 41 and with no other gap', async () => {
    const migrations = await loadMigrations()
    const versions = [...migrations.keys()]
    const last = Math.max(...versions)
    const expected = Array.from({ length: last }, (_, i) => i + 1).filter(version => version !== 40 && version !== 41)
    expect(versions).toEqual(expected)
    expect(versions[0]).toBe(1)
    for (const body of migrations.values()) expect(body.length).toBeGreaterThan(0)
  })

  it('reads each file under the version its name carries, in ascending order', async () => {
    const migrations = await loadMigrations(await folder('schema_003.sql', 'schema_001.sql', 'schema_002.sql'))
    expect([...migrations]).toEqual([[1, 'schema_001.sql'], [2, 'schema_002.sql'], [3, 'schema_003.sql']])
  })

  it('accepts the known gap at 40 and 41', async () => {
    const present = Array.from({ length: 39 }, (_, i) => `schema_${String(i + 1).padStart(3, '0')}.sql`)
    const migrations = await loadMigrations(await folder(...present, 'schema_042.sql'))
    expect([...migrations.keys()].slice(-2)).toEqual([39, 42])
  })

  it('refuses a stray file instead of skipping it', async () => {
    await expect(loadMigrations(await folder('schema_001.sql', 'notes.txt'))).rejects.toThrow('notes.txt, which is not named schema_NNN.sql')
  })

  it('ignores dotfiles such as .DS_Store', async () => {
    const migrations = await loadMigrations(await folder('schema_001.sql', '.DS_Store'))
    expect([...migrations.keys()]).toEqual([1])
  })

  it('refuses a misnamed migration', async () => {
    await expect(loadMigrations(await folder('schema_001.sql', 'schema_2.sql'))).rejects.toThrow('schema_2.sql, which is not named schema_NNN.sql')
    await expect(loadMigrations(await folder('schema_001.sql', 'schema_002.SQL'))).rejects.toThrow('schema_002.SQL')
  })

  it('refuses the old name of the first migration', async () => {
    await expect(loadMigrations(await folder('schema.sql', 'schema_002.sql'))).rejects.toThrow('schema.sql, which is not named schema_NNN.sql')
  })

  it('refuses a second file for a version, since its name cannot match the pattern', async () => {
    await expect(loadMigrations(await folder('schema_001.sql', 'schema_01.sql'))).rejects.toThrow('schema_01.sql, which is not named schema_NNN.sql')
    await expect(loadMigrations(await folder('schema_001.sql', 'schema_002.sql', 'schema_002.sql.bak'))).rejects.toThrow('schema_002.sql.bak')
  })

  it('refuses a gap that is not 40 and 41', async () => {
    await expect(loadMigrations(await folder('schema_001.sql', 'schema_002.sql', 'schema_004.sql'))).rejects.toThrow('no file for version 3: schema_003.sql is missing')
  })

  it('refuses a folder without version 1', async () => {
    await expect(loadMigrations(await folder('schema_002.sql', 'schema_003.sql'))).rejects.toThrow('no schema_001.sql')
  })

  it('refuses version 0', async () => {
    await expect(loadMigrations(await folder('schema_000.sql', 'schema_001.sql'))).rejects.toThrow('schema_000.sql has no valid version')
  })
})
