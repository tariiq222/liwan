import { readFileSync } from 'node:fs'
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

const GRID_CLASS = 'grid min-w-0 gap-(--liwan-gap-card) lg:grid-flow-col lg:grid-cols-[minmax(0,2fr)] lg:auto-cols-[minmax(0,1fr)]'
const CARD_BASE = 'flex flex-col justify-between gap-3 rounded-card px-(--liwan-card-pad) py-4'
const CHIP_BASE = 'hidden size-10 shrink-0 place-items-center rounded-control sm:grid'

const TONE_CLASSES = [
  [
    'info',
    'from-info/10 via-info/[0.03] to-default ring ring-info/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-info/15 dark:via-info/5 dark:to-default',
    'bg-info/15 text-status-info-foreground',
  ],
  [
    'success',
    'from-success/10 via-success/[0.03] to-default ring ring-success/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-success/15 dark:via-success/5 dark:to-default',
    'bg-status-success-soft text-status-success-foreground',
  ],
  [
    'warning',
    'from-warning/10 via-warning/[0.03] to-default ring ring-warning/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-warning/15 dark:via-warning/5 dark:to-default',
    'bg-status-warning-soft text-status-warning-foreground',
  ],
  [
    'danger',
    'from-error/10 via-error/[0.03] to-default ring ring-error/25 rtl:bg-linear-270 ltr:bg-linear-90 dark:from-error/15 dark:via-error/5 dark:to-default',
    'bg-status-danger-soft text-status-danger-foreground',
  ],
  [
    'neutral',
    'bg-elevated/40 ring ring-default',
    'bg-elevated text-muted',
  ],
] as const

describe('SharedRecordHero', () => {
  it('stays presentational with logical properties, named radii, and token motion only', () => {
    const source = readFileSync(file, 'utf8')
    expect(PHYSICAL_DIRECTION.test(source), 'must use logical direction properties only').toBe(false)
    expect(RAW_RADIUS.test(source), 'must use named Liwan radius tokens only').toBe(false)
    expect(NUMERIC_DURATION.test(source), 'must not hardcode numeric duration-* utilities').toBe(false)
    expect(FORBIDDEN_IMPORTS.test(source), 'must not import from apps/web or @liwan/contracts').toBe(false)
  })

  it.each(TONE_CLASSES)('renders tone %s with its exact surface and icon chip classes', async (tone, surface, chip) => {
    const html = await renderShared(
      'RecordHero',
      { tone, icon: 'i-lucide-calendar-clock' },
      {
        title: () => h('span', '2026-10-18'),
        meta: () => h('span', 'Organizer'),
        actions: () => h('button', { type: 'button' }, 'Join'),
      },
    )
    expect(html).toContain('data-slot="record-hero"')
    expect(html).toContain(`data-tone="${tone}"`)
    expect(html).toContain(`class="${CARD_BASE} ${surface}"`)
    expect(html).toContain(`class="${CHIP_BASE} ${chip}"`)
    expect(html).toContain('name="i-lucide-calendar-clock"')
    expect(html).toContain('2026-10-18')
    expect(html).toContain('Organizer')
    expect(html).toContain('Join')
  })

  it('uses the same flow-col grid for 1, 2, and 3 tiles, and a single full-width card without tiles', async () => {
    const rootClassOf = (html: string) => html.match(/<div[^>]*data-slot="record-hero"[^>]*class="([^"]+)"/)?.[1]
    const classes: (string | undefined)[] = []

    for (const count of [1, 2, 3]) {
      const html = await renderShared(
        'RecordHero',
        { tone: 'info' },
        {
          title: () => h('span', 'Title'),
          default: () => Array.from({ length: count }, (_, i) => h('div', { 'data-tile': String(i + 1) }, `Tile ${i + 1}`)),
        },
      )
      classes.push(rootClassOf(html))
      for (let i = 1; i <= count; i++) expect(html).toContain(`data-tile="${i}"`)
    }

    expect(classes).toEqual([GRID_CLASS, GRID_CLASS, GRID_CLASS])

    const withoutTiles = await renderShared(
      'RecordHero',
      { tone: 'neutral' },
      { title: () => h('span', 'Cancelled') },
    )
    expect(withoutTiles).toContain('data-slot="record-hero"')
    expect(withoutTiles).not.toContain('lg:grid-flow-col')
    expect(withoutTiles).not.toContain('lg:grid-cols-[minmax(0,2fr)]')
    expect(withoutTiles).toContain('Cancelled')
  })
})
