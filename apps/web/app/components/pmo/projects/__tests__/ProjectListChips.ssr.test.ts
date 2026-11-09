import { resolve } from 'node:path'
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import * as chips from '../../../../utils/projectListChips'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const render = (props: Record<string, unknown>, hydrated = true) => renderShared(resolve(import.meta.dirname, '../ProjectListChips.vue'), props, {}, {
  globals: { useI18n: () => ({ t: (key: string) => key }), useHydrated: () => ref(hydrated), computed },
  modules: { '@/utils/projectListChips': chips },
})
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ attrs: match[1]!, text: match[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))

describe('project list chips', () => {
  const counts = { all: 9, mine: 3, attention: 3, at_risk: 2, off_track: 1, on_track: 4, on_hold: 0, done: 1 }

  it('draws one pressed chip per preset with its Latin count, the archived one only for a manager', async () => {
    const html = await render({ selected: 'attention', counts, archivedAvailable: true })
    const all = buttons(html)
    expect(all.map(button => button.text)).toEqual([
      'projects.filters.chipAll 9', 'nav.myProjects 3', 'nav.needsAttention 3', 'projects.status.at_risk 2', 'projects.status.off_track 1',
      'projects.status.on_track 4', 'projects.status.on_hold 0', 'projects.status.done 1', 'projects.filters.archived',
    ])
    expect(all.filter(button => button.attrs.includes('aria-pressed="true"')).map(button => button.text)).toEqual(['nav.needsAttention 3'])
    expect(html).toContain('data-testid="projects-chip-attention"')
    expect(html).toContain('aria-label="projects.filters.chipsLabel"')
    expect(buttons(await render({ selected: 'all', counts, archivedAvailable: false })).map(button => button.text)).not.toContain('projects.filters.archived')
  })

  it('shows no pressed chip for a mix of filters and waits for hydration before enabling', async () => {
    const mixed = buttons(await render({ selected: null, counts: {}, archivedAvailable: false }, false))
    expect(mixed.some(button => button.attrs.includes('aria-pressed="true"'))).toBe(false)
    expect(mixed.every(button => button.attrs.includes('disabled'))).toBe(true)
    expect(mixed[0]!.text).toBe('projects.filters.chipAll')
  })
})
