import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function collectVueFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (name === '__tests__' || !statSync(path).isDirectory()) return name.endsWith('.vue') ? [path] : []
    return collectVueFiles(path)
  })
}

function accessComponentSource() {
  const directory = join(import.meta.dirname, '..')
  const files = collectVueFiles(directory)
  expect(files.length, 'access components are not present yet').toBeGreaterThan(0)
  return files.map((path) => readFileSync(path, 'utf8')).join('\n')
}

describe('access component state contract', () => {
  it('represents protected records and server allowed actions explicitly', () => {
    const source = accessComponentSource()
    expect(source).toMatch(/protected/)
    expect(source).toMatch(/allowed_actions/)
    expect(source).toMatch(/read[-_ ]?only|readonly/i)
  })

  it('renders write controls only from the returned action set and exposes forbidden/conflict states', () => {
    const source = accessComponentSource()
    expect(source).toMatch(/allowed_actions.*(includes|\.includes)/s)
    expect(source).toMatch(/403|forbidden|protected[_A-Z]?user/i)
    expect(source).toMatch(/409|conflict|current_version|reload/i)
  })

  it('explains that disabling a custom role blocks new assignments but keeps existing effects', () => {
    const source = accessComponentSource()
    expect(source).toMatch(/!props\.role\.active|!role\.active|role\.active.*selectedRoleIds/s)
    expect(source).toMatch(/existing|already|remain|current/i)
    expect(source).toMatch(/assignment/i)
  })

  it('does not render password or session secrets from user and audit response data', () => {
    const source = accessComponentSource()
    expect(source).not.toMatch(/\{\{\s*(?:user|event|query\.data\.value|props\.user)\.[^}]*\b(password|password_hash|session_id|token|hash)\b[^}]*\}\}/i)
    expect(source).not.toMatch(/before\.(password|token|session_id|hash)|after\.(password|token|session_id|hash)/i)
  })
})
