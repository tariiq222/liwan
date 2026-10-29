import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The finance drafts keep typed amounts as strings and parse them when validated. A `UInput type="number"`
// emits a Number after an edit, so a draft helper calling `.trim()` on it throws while the user types (#169).
// Decimal boxes are therefore text boxes with `inputmode="decimal"`; only a `v-model.number` box may be numeric.
const finance = resolve(import.meta.dirname, '..')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : vueFiles(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

const inputs = vueFiles(finance).flatMap(file =>
  (readFileSync(file, 'utf8').match(/<UInput\b[^>]*>/g) ?? []).map(tag => ({ file: relative(finance, file), tag })))

describe('finance decimal inputs keep the typed string', () => {
  it('finds the decimal inputs', () => {
    expect(inputs.filter(({ tag }) => tag.includes('inputmode="decimal"')).length).toBeGreaterThan(20)
  })

  it.each(inputs.filter(({ tag }) => tag.includes('type="number"')))('$file numeric box binds a number', ({ tag }) => {
    expect(tag).toContain('v-model.number=')
  })
})
