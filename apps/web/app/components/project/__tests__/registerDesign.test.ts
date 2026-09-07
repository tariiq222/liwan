import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const listSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../pages/projects/[id]/register/index.vue'),
  'utf8',
)

describe('register list design alignment', () => {
  it('uses the /projects toolbar, FilterBar, NativeSelect, and Table primitives', () => {
    expect(listSource).toContain('class="nasq-toolbar"')
    expect(listSource).toContain("import FilterBar from '@/components/shared/FilterBar.vue'")
    expect(listSource).toContain('<NativeSelect')
    expect(listSource.match(/class="h-\[40px\] w-40"/g)?.length).toBe(3)
    expect(listSource).toContain('<Table>')
    expect(listSource).toContain('<TableHeader>')
    expect(listSource).toContain('<TableBody>')
    expect(listSource).not.toContain('nasq-input')
    expect(listSource).not.toMatch(/class="flex flex-wrap items-center gap-3"/)
    expect(listSource).not.toMatch(/<(Dialog|Sheet|Drawer)\b/)
  })

  it('keeps query filters, pagination, gates, inline delete, and returnTo links', () => {
    expect(listSource).toContain("setFilter('q'")
    expect(listSource).toContain("setFilter('kind'")
    expect(listSource).toContain("setFilter('status'")
    expect(listSource).toContain("setFilter('priority'")
    expect(listSource).toContain('offset: undefined')
    expect(listSource).toContain('function page(delta: number)')
    expect(listSource).toContain('list.data.value?.can_manage && hydrated')
    expect(listSource).toContain(':disabled="!hydrated"')
    expect(listSource).toContain('confirmDeleteId')
    expect(listSource).toContain('projects.governance.confirmDeleteAction')
    expect(listSource).toContain('query: { returnTo }')
    expect(listSource).toContain('`/projects/${id}/register/${item.id}`')
    expect(listSource).toContain(':back-to="`/projects/${id}`"')
  })
})
