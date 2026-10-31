import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the `@media print { … }` block, brace-matched. */
function printBlock(source: string): string {
  const start = source.indexOf('@media print')
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(open + 1, index)
  }
  return ''
}

/** Declarations of every rule in `block` whose selector list names `selector`. */
function declarations(block: string, selector: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1]!.split(',').map(part => part.trim()).includes(selector)) continue
    for (const declaration of match[2]!.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon > 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
    }
  }
  return found
}

const print = printBlock(css)

describe('the print sheet', () => {
  it('names a landscape page that .liwan-print-landscape selects', () => {
    expect(declarations(print, '@page liwan-landscape').get('size')).toBe('A4 landscape')
    expect(declarations(print, '@page liwan-landscape').get('margin')).toBe('12mm')
    expect(declarations(print, '.liwan-print-landscape').get('page')).toBe('liwan-landscape')
  })

  it('never prints the shell chrome or a .liwan-print-hide element', () => {
    for (const selector of ['.liwan-shell-header', '.liwan-module-rail', '.liwan-context-sidebar', '.liwan-mobile-menu-trigger', '.liwan-print-hide']) {
      expect(declarations(print, selector).get('display'), selector).toBe('none !important')
    }
    expect(declarations(print, '.liwan-shell-workspace').get('margin-inline')).toBe('0 !important')
    expect(declarations(print, '.liwan-shell-workspace').get('padding-block-start')).toBe('0 !important')
  })

  it('never prints the Sadu strip', () => {
    expect(declarations(print, '.liwan-shell::after').get('display')).toBe('none !important')
  })

  it('draws the Sadu strip as a 6px sand triangle row in the shell, with whole teeth only', () => {
    const shell = readFileSync(resolve(import.meta.dirname, '../shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const strip = declarations(shell, '.liwan-shell::after')
    expect(shell).toContain('--liwan-sadu-height: 6px')
    expect(strip.get('background')).toContain('var(--liwan-sand)')
    expect(strip.get('background')).toContain('conic-gradient')
    expect(strip.get('background-repeat')).toBe('round no-repeat')
    expect(strip.get('pointer-events')).toBe('none')
    expect(strip.get('height')).toBe('var(--liwan-sadu-height)')
  })

  it('prints a .liwan-print page black on white through the tokens and their aliases', () => {
    const page = declarations(print, '.liwan-print')
    for (const token of ['--ui-bg', '--ui-bg-muted', '--ui-bg-elevated', '--ui-bg-accented', '--background', '--card', '--muted']) {
      expect(page.get(token), token).toBe('#fff')
    }
    for (const token of ['--ui-text', '--ui-text-highlighted', '--ui-text-muted', '--ui-text-toned', '--ui-text-dimmed', '--ui-border', '--ui-border-muted', '--ui-border-accented', '--foreground', '--muted-foreground', '--border']) {
      expect(page.get(token), token).toBe('#000')
    }
    expect(page.get('color')).toBe('#000')
    expect(page.get('background')).toBe('#fff')
  })

  it('uses logical properties only', () => {
    expect(print).not.toMatch(/(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:/)
  })
})
