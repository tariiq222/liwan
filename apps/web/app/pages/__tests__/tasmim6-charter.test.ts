import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the project file prints through the print template', () => {
  it('the charter page has no scoped style and the read view is a print page', () => {
    const page = read('pages/projects/[id]/charter.vue')
    expect(page).toContain('<SharedStandalonePage')
    expect(page).toContain('variant="print"')
    for (const gone of ['<style', 'project-charter-print-scope', 'visibility: hidden']) expect(page).not.toContain(gone)
  })
  it('the display uses record sections and keeps its ids', () => {
    const display = read('components/project/ProjectCharterDisplay.vue')
    expect(display).not.toContain('<UCard')
    for (const id of ['project-charter-essentials', 'project-charter-purpose', 'project-charter-objectives', 'project-charter-scope', 'charter-milestone-outputs', 'project-charter-budget']) expect(display).toContain(`id="${id}"`)
  })
  it('the new-project page uses the shared states and the policy no longer lists charter.vue as a style owner', () => {
    expect(read('pages/projects/new.vue')).toContain('<SharedPageState')
    expect(readFileSync(resolve(app, '../../../tools/ui_policy.py'), 'utf8')).not.toContain("PAGES + 'projects/[id]/charter.vue'")
  })
})
