import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from './helpers/renderShared'

const root = fileURLToPath(new URL('..', import.meta.url))
const file = join(root, 'app/components/shared/layout/RecordHero.vue')

const PHYSICAL_DIRECTION = /(?<![\w-])(?:ml|mr|pl|pr)-(?:\d|px|auto|\[)|(?<![\w-])(?:left|right)-(?:\d|px|full|auto|\[)|(?<![\w-])text-(?:left|right)(?![\w-])/
const RAW_RADIUS = /(?<![\w-])rounded-(?:sm|md|lg|xl)(?![\w-])/
const NUMERIC_DURATION = /\bduration-\d/
const FORBIDDEN_IMPORTS = /(?:apps\/web|@liwan\/contracts|from\s+['"](?:@@?|~~?)\/)/

describe('SharedRecordHero', () => {
  it('exists and keeps the presentational source contract', () => {
    expect(existsSync(file)).toBe(true)
    const source = readFileSync(file, 'utf8')

    for (const slot of ['title', 'meta', 'actions', 'default']) {
      expect(source, `missing slot ${slot}`).toContain(slot)
    }
    expect(source).toContain('name="title"')
    expect(source).toContain('name="meta"')
    expect(source).toContain('name="actions"')
    expect(source).toMatch(/<slot\s*\/>/)

    for (const tone of ['info', 'success', 'warning', 'danger', 'neutral']) {
      expect(source, `missing tone ${tone}`).toMatch(new RegExp(`\\b${tone}:`))
    }

    expect(PHYSICAL_DIRECTION.test(source), 'must use logical direction properties only').toBe(false)
    expect(RAW_RADIUS.test(source), 'must use named Liwan radius tokens only').toBe(false)
    expect(NUMERIC_DURATION.test(source), 'must not hardcode numeric duration-* utilities').toBe(false)
    expect(FORBIDDEN_IMPORTS.test(source), 'must not import from apps/web or @liwan/contracts').toBe(false)
  })

  it('renders a 3-track grid with tiles and a single full-width card without tiles', async () => {
    const withTiles = await renderShared(
      'RecordHero',
      { icon: 'i-lucide-calendar-clock', tone: 'info' },
      {
        title: () => h('span', '2026-10-18'),
        meta: () => h('span', 'Organizer'),
        actions: () => h('button', { type: 'button' }, 'Join'),
        default: () => [h('div', { 'data-tile': '1' }, 'Tile 1'), h('div', { 'data-tile': '2' }, 'Tile 2')],
      },
    )
    expect(withTiles).toContain('data-slot="record-hero"')
    expect(withTiles).toContain('data-tone="info"')
    expect(withTiles).toContain('lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]')
    expect(withTiles).toContain('2026-10-18')
    expect(withTiles).toContain('Organizer')
    expect(withTiles).toContain('Join')
    expect(withTiles).toContain('data-tile="1"')
    expect(withTiles).toContain('data-tile="2"')

    const withoutTiles = await renderShared(
      'RecordHero',
      { tone: 'neutral' },
      { title: () => h('span', 'Cancelled') },
    )
    expect(withoutTiles).toContain('data-slot="record-hero"')
    expect(withoutTiles).toContain('data-tone="neutral"')
    expect(withoutTiles).not.toContain('lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]')
    expect(withoutTiles).toContain('Cancelled')
  })
})
