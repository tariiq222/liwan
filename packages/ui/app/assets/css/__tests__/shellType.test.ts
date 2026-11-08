import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guard for the shell's type sizes (DESIGN.md §1): the smallest text is `--text-xs` (12px at the 14px root). A raw `rem` size is
// scaled by the root, so `.75rem` is 10.5px at the small root; the shell takes its sizes from the tokens, or from a raw size no
// smaller than `--text-xs` itself.
const css = resolve(import.meta.dirname, '..')
const read = (name: string) => readFileSync(resolve(css, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const TEXT_XS_REM = Number.parseFloat(/--text-xs:\s*([\d.]+)rem/.exec(read('tokens.css'))![1]!)

describe('shell type sizes', () => {
  const sizes = [...read('shell.css').matchAll(/([^{}]+)\{[^{}]*?font-size:\s*([^;}]+)[;}]/g)].map(match => ({ selector: match[1]!.trim(), size: match[2]!.trim() }))

  it('declares sizes', () => {
    expect(sizes.length).toBeGreaterThan(20)
  })

  it('never sets text under --text-xs', () => {
    for (const { selector, size } of sizes) {
      if (size.startsWith('var(--text-')) continue
      const rem = /^(\d*\.?\d+)rem$/.exec(size)
      expect(rem, `${selector}: ${size}`).not.toBeNull()
      expect(Number.parseFloat(rem![1]!), `${selector}: ${size}`).toBeGreaterThanOrEqual(TEXT_XS_REM)
    }
  })

  it('sets the notification panel row from the tokens', () => {
    const shell = read('shell.css')
    expect(shell).toMatch(/\.liwan-panel-row \[data-slot="title"\][^{]*\{[^}]*font-size: var\(--text-sm\)/)
    expect(shell).toMatch(/\.liwan-panel-row \[data-slot="caption"\][^{]*\{[^}]*font-size: var\(--text-xs\)/)
  })
})
