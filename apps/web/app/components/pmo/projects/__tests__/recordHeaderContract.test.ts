import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('project record header and list contracts', () => {
  it('draws the trail, the title with one status tag, a muted owner and dates line and the header actions in one identity row', () => {
    const frame = read('pages/projects/[id].vue')
    const row = frame.slice(frame.indexOf('data-testid="project-workspace-identity"'), frame.indexOf('<ProjectPhaseStepper'))
    expect(row).toContain("'project-workspace-back'")
    expect(row).toContain('data-testid="project-workspace-name"')
    expect(frame).toContain("statusTag(projectBadge(value.status), 'project-status')")
    expect(row).toContain('<ProjectWorkspaceActions')
    expect(row).toContain('data-testid="project-workspace-meta"')
    expect(row).toContain('data-testid="project-workspace-dates"')
    // The owner and the dates are plain muted text, not tags; the phase belongs to the stepper.
    expect(frame).not.toMatch(/kind: 'person'|kind: 'schedule'|project-workspace-phase/)
    // The old layout put the back control in its own row above the title.
    expect(frame).not.toContain('<div v-if="backTo" class="flex items-center gap-2 text-sm">')
  })

  it('treats ?view=list as the table view', () => {
    const page = read('pages/projects/index.vue')
    expect(page).toContain("view !== 'list'")
    expect(page).toContain("view: 'table'")
  })

  it('uses UCollapsible, not native details, for optional charter sections', () => {
    const display = read('components/pmo/projects/ProjectCharterDisplay.vue')
    expect(display).toContain('<UCollapsible')
    expect(display).not.toContain('<details')
  })

  it('does not repeat the charter sub-tab name as a heading', () => {
    expect(read('pages/projects/[id]/charter.vue')).toMatch(/<SharedPageHeader class="liwan-print-hide" hide-title/)
  })

  it('gives every project row an action control', () => {
    const menu = read('components/pmo/projects/ProjectMenu.vue')
    expect(menu).toContain('<SharedRowActions')
    expect(read('components/pmo/projects/ProjectCardBody.vue')).toContain(':to="toFor(project)"')
    expect(read('components/pmo/projects/ProjectTable.vue')).toContain(':to="toFor(row.original)"')
  })
})
