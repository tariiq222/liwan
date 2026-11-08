import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guard for the shared motion system (DESIGN.md §3 «الحركة»): every duration comes from the motion tokens, the tokens
// collapse under prefers-reduced-motion, and the entrance recipes that use keyframes are switched off there too.
const css = resolve(import.meta.dirname, '..')
const read = (name: string) => readFileSync(resolve(css, name), 'utf8')
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '')

/** [selector, declaration name, value] for every rule that sets a transition or an animation. */
function motionDeclarations(source: string): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const rule of strip(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of rule[2]!.split(';')) {
      const match = declaration.match(/^\s*(transition(?:-duration)?|animation(?:-duration)?)\s*:\s*([\s\S]+)$/)
      if (match) out.push([rule[1]!.trim(), match[1]!, match[2]!.trim()])
    }
  }
  return out
}

// Decorative marks with their own long timing, each switched off under reduced motion in components.css.
const DECORATIVE = /sadu|liwan-mark-|chart|dept-tree/

describe('motion tokens', () => {
  const tokens = read('tokens.css')

  it('defines feedback, panel, ease, inline distance, exit and rise on :root', () => {
    for (const token of ['--liwan-motion-feedback: 150ms', '--liwan-motion-panel: 200ms', '--liwan-motion-ease: cubic-bezier(0.2, 0, 0, 1)', '--liwan-motion-inline-distance: 16px', '--liwan-motion-rise: 6px']) {
      expect(tokens).toContain(token)
    }
    expect(tokens).toMatch(/--liwan-motion-exit: calc\(var\(--liwan-motion-feedback\) \* 0\.6\)/)
  })

  it('collapses every duration and distance under prefers-reduced-motion', () => {
    const reduced = tokens.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/)![1]!
    for (const token of ['--liwan-motion-feedback: 0ms', '--liwan-motion-panel: 0ms', '--liwan-motion-inline-distance: 0px', '--liwan-motion-rise: 0px']) {
      expect(reduced).toContain(token)
    }
  })

  it('flips the inline sign in RTL so a slide follows the reading direction', () => {
    expect(tokens).toContain('--liwan-inline-sign: 1;')
    expect(tokens).toContain(':root[dir="rtl"] { --liwan-inline-sign: -1; }')
  })

  it('points Tailwind transition utilities at the feedback token', () => {
    expect(tokens).toContain('--default-transition-duration: var(--liwan-motion-feedback);')
  })
})

describe('motion recipes', () => {
  it.each(['shell.css', 'layout.css', 'components.css'])('%s takes every transition and animation duration from the tokens', (name) => {
    const literal = motionDeclarations(read(name))
      .filter(([selector]) => !DECORATIVE.test(selector))
      .filter(([, , value]) => /(^|[\s,(])\d*\.?\d+m?s\b/.test(value))
    expect(literal).toEqual([])
  })

  it('moves only the page area on a route change, with the page classes neutralised for reduced motion', () => {
    const layout = strip(read('layout.css'))
    expect(layout).toMatch(/\.liwan-page-enter-from \{ opacity: 0; translate: 0 var\(--liwan-motion-rise\); \}/)
    expect(layout).toMatch(/\.liwan-page-leave-active \{ transition: opacity var\(--liwan-motion-exit\)/)
    expect(layout).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.liwan-page-enter-active, \.liwan-page-leave-active \{ transition: none; \}\s*\.liwan-soft-in \{ animation: none; \}/)
    expect(layout).not.toContain('liwan-page-content-motion')
  })

  it('slides a slide-over in from the inline-end, quicker on the way out', () => {
    const shell = strip(read('shell.css'))
    expect(shell).toMatch(/\.liwan-slideover-enter-from, \.liwan-slideover-leave-to \{ opacity: 0; translate: calc\(var\(--liwan-motion-inline-distance\) \* var\(--liwan-inline-sign\)\) 0; \}/)
    expect(shell).toMatch(/\.liwan-slideover-leave-active \{ transition: opacity var\(--liwan-motion-exit\)/)
  })

  it('swaps the sidebar body in the reading direction and folds the organisation card', () => {
    const shell = strip(read('shell.css'))
    expect(shell).toContain('.liwan-side-swap-enter-from { opacity: 0; translate: calc(var(--liwan-motion-inline-distance) * var(--liwan-inline-sign)) 0; }')
    expect(shell).toContain('.liwan-side-swap[data-mode="global"].liwan-side-swap-enter-from')
    expect(shell).toContain('.liwan-side-orgslot-leave-to')
  })

  it('switches off every keyframe animation of the shell and the shared entrance under reduced motion', () => {
    const shell = strip(read('shell.css'))
    const reduced = shell.match(/@media \(prefers-reduced-motion: reduce\) \{\s*([^{]+)\{([^}]*)\}/)!
    expect(reduced[1]).toContain('.liwan-shell *')
    expect(reduced[1]).toContain('.liwan-app-switcher')
    expect(reduced[1]).toContain('.liwan-mobile-menu-overlay')
    expect(reduced[2]).toMatch(/animation: none !important;\s*transition: none !important;/)
  })

  it('lifts an interactive card on the tokens and drops the lift under reduced motion', () => {
    const components = strip(read('components.css'))
    expect(components).toMatch(/\.liwan-lift \{\s*transition: transform var\(--liwan-motion-panel\) var\(--liwan-motion-ease\)/)
    expect(components).toMatch(/\.liwan-lift:active \{ transform: translateY\(0\); \}/)
    expect(components).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.liwan-lift \{ transition: none; \}\s*\.liwan-lift:hover, \.liwan-lift:active \{ transform: none; \}/)
  })
})
