import { describe, expect, it } from 'vitest'
import { groupTokens, isColorToken, parseTokenNames } from '../tokens'

const css = `@theme { --text-xs: 0.85rem; }
:root {
  /* --commented-out: red; */
  --liwan-surface: #fff;
  --ui-bg: var(--liwan-surface);
  --liwan-radius: 14px;
}
.dark { --liwan-surface: #111; --status-danger: #f00; }`

describe('token names from tokens.css', () => {
  it('lists each declared custom property once, in source order, ignoring comments and usages', () => {
    expect(parseTokenNames(css)).toEqual(['--text-xs', '--liwan-surface', '--ui-bg', '--liwan-radius', '--status-danger'])
  })

  it('groups by the first name segment', () => {
    expect(groupTokens(parseTokenNames(css))).toEqual([
      { prefix: 'status', names: ['--status-danger'] },
      { prefix: 'text', names: ['--text-xs'] },
      { prefix: 'ui', names: ['--ui-bg'] },
      { prefix: 'liwan', names: ['--liwan-surface', '--liwan-radius'] },
    ])
  })

  it.each([
    ['--liwan-surface', true],
    ['--status-danger-soft', true],
    ['--liwan-radius', false],
    ['--elevation-2', false],
    ['--liwan-ui-z-menu', false],
    ['--text-xs', false],
    ['--font-sans', false],
    ['--shell-header-height', false],
    ['--project-type-caption', false],
    ['--project-section-surface', true],
  ])('%s is a colour token: %s', (name, expected) => {
    expect(isColorToken(name)).toBe(expected)
  })
})
