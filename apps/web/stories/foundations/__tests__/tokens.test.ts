import { describe, expect, it } from 'vitest'
import { groupTokens, isColorToken, parseTokenNames } from '../tokens'

const css = `@theme { --text-xs: 0.85rem; }
:root {
  /* --commented-out: red; */
  --webvue-surface: #fff;
  --ui-bg: var(--webvue-surface);
  --webvue-radius: 14px;
}
.dark { --webvue-surface: #111; --status-danger: #f00; }`

describe('token names from tokens.css', () => {
  it('lists each declared custom property once, in source order, ignoring comments and usages', () => {
    expect(parseTokenNames(css)).toEqual(['--text-xs', '--webvue-surface', '--ui-bg', '--webvue-radius', '--status-danger'])
  })

  it('groups by the first name segment', () => {
    expect(groupTokens(parseTokenNames(css))).toEqual([
      { prefix: 'status', names: ['--status-danger'] },
      { prefix: 'text', names: ['--text-xs'] },
      { prefix: 'ui', names: ['--ui-bg'] },
      { prefix: 'webvue', names: ['--webvue-surface', '--webvue-radius'] },
    ])
  })

  it.each([
    ['--webvue-surface', true],
    ['--status-danger-soft', true],
    ['--webvue-radius', false],
    ['--elevation-2', false],
    ['--webvue-ui-z-menu', false],
    ['--text-xs', false],
    ['--font-sans', false],
    ['--shell-header-height', false],
    ['--project-type-caption', false],
    ['--project-section-surface', true],
  ])('%s is a colour token: %s', (name, expected) => {
    expect(isColorToken(name)).toBe(expected)
  })
})
