import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Geometry must be owned by tokens: a radius or density change is one edit in
// tokens.css, never a sweep over rounded-*/p-* classes in components.
const css = readFileSync(resolve(import.meta.dirname, '../css/tokens.css'), 'utf8')

describe('geometry tokens', () => {
  it('overrides the Tailwind radius scale so rounded-* classes follow the system', () => {
    expect(css).toMatch(/@theme\s*\{[^}]*--radius-lg:\s*8px/s)
    expect(css).toMatch(/--radius-md:\s*6px/)
    expect(css).toMatch(/--radius-xl:\s*10px/)
    expect(css).toMatch(/--nasq-radius:\s*8px/)
  })

  it('defines --ui-radius exactly once', () => {
    expect(css.match(/--ui-radius:/g)?.length).toBe(1)
    expect(css).toMatch(/--ui-radius:\s*6px/)
  })

  it('exposes a hover surface and fixed state/priority tokens in all three modes', () => {
    for (const token of ['--nasq-surface-hover', '--state-in-progress', '--state-done', '--priority-urgent']) {
      expect(css.match(new RegExp(`${token}:`, 'g'))?.length, token).toBeGreaterThanOrEqual(3)
    }
    expect(css).not.toMatch(/--state-[a-z-]+:\s*var\(--primary/)
    expect(css).not.toMatch(/--priority-[a-z-]+:\s*var\(--primary/)
  })
})
