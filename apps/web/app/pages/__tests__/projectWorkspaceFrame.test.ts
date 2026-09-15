import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// This repo has no DOM/component-mount harness (no @nuxt/test-utils, no jsdom),
// so page structure is asserted against the source the way the shell suite does.
const pages = resolve(import.meta.dirname, '..')
const framePath = resolve(pages, 'projects/[id].vue')
const summaryPath = resolve(pages, 'projects/[id]/index.vue')
const sectionsPath = resolve(pages, '../composables/nav/projectSections.ts')
const frame = readFileSync(framePath, 'utf8')

/** Structural markers that must only ever live in the section pages, not the frame. */
const MOVED_OUT = [
  '?tab=',
  'planningView',
  'TaskTable',
  'TaskBoard',
  'TaskToolbar',
  'MilestoneTable',
  'projectContextId',
  'projectContextLinks',
  'isProjectOverlayRoute',
  'taskContext',
]

describe('project workspace frame', () => {
  it('keeps the identity row, the tab strip and the child outlet', () => {
    expect(frame).toContain('data-testid="project-workspace-identity"')
    expect(frame).toContain('ProjectWorkspaceTabs')
    // Without the outlet every /projects/:id/* child route renders blank.
    expect(frame).toContain('<NuxtPage')
  })

  it('owns the page heading and gives it to the project name', () => {
    expect(frame.match(/<h1\b/g) ?? []).toHaveLength(1)
    const heading = frame.split('\n').find(line => line.includes('<h1'))
    expect(heading).toBeDefined()
    expect(heading).toContain('data-testid="project-workspace-name"')
  })

  it('passes ProjectWorkspaceTabs only the props it declares', () => {
    const tag = frame.match(/<ProjectWorkspaceTabs\b[^>]*>/s)?.[0]
    expect(tag).toBeDefined()
    // Task 4 removed can-manage; passing it leaves an inert attribute on <nav>.
    expect(tag).not.toContain('can-manage')
  })

  // The useNav split deleted `grants settings only to record managers` along
  // with the abstraction it tested, but the gate itself survived in the frame
  // and is permission-bearing, so the behaviour keeps its own assertion here.
  it('offers project settings only to someone who can manage the record', () => {
    const button = frame.match(/<UButton\b(?:(?!<\/?UButton)[\s\S])*?data-testid="project-workspace-settings"[\s\S]*?>/)?.[0]
      ?? frame.match(/<UButton\b[^>]*project-workspace-settings[^>]*>/s)?.[0]
    expect(button, 'the settings control should still exist').toBeDefined()
    expect(button).toContain('v-if="project?.can_manage"')
  })

  it('shows itself on the sections, their records and project settings, and nowhere else', () => {
    // Nothing here asserted showFrame before, so replacing it with
    // `computed(() => true)` used to leave the whole suite green.
    const showFrame = frame.slice(frame.indexOf('const showFrame'))
    expect(showFrame).toContain('activeProjectSection(route.path) !== null')
    expect(showFrame).toContain('isProjectSettings')
    // A bad id and a 403/404 have no identity to show.
    expect(showFrame).toContain('!notFound.value')
    // A failed load with nothing cached must not leave an empty identity strip.
    expect(showFrame).toContain('!(error.value && !projectData.value)')
  })

  it('keeps project settings inside the workspace without a settings tab', () => {
    // settings is not one of the eight sections, so activeProjectSection is
    // null there; the frame has to name that case itself or the settings page
    // loses the project identity and every route back to the project.
    const settings = frame.match(/const isProjectSettings = computed\([\s\S]*?\n(?=const |\/\/ )/)?.[0]
    expect(settings).toBeDefined()
    expect(settings).toContain('settingsTo.value')
    expect(settings).toContain('projectId.value !== null')
    const button = frame.match(/<UButton\b[^>]*data-testid="project-workspace-settings"[^>]*\/>/s)?.[0]
    expect(button).toBeDefined()
    expect(button).toContain(":aria-current=\"isProjectSettings ? 'page' : undefined\"")
    // The tab strip must not grow a ninth tab for it.
    expect(readFileSync(sectionsPath, 'utf8')).not.toContain("id: 'settings'")
  })

  it('no longer renders any section content inline', () => {
    for (const marker of MOVED_OUT) expect(frame, marker).not.toContain(marker)
  })
})

describe('project summary child page', () => {
  it('exists so /projects/:id renders inside the frame', () => {
    expect(existsSync(summaryPath)).toBe(true)
  })

  it('renders the overview and leaves the only h1 to the frame', () => {
    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toContain('ProjectOverview')
    expect(summary).not.toContain('<h1')
  })
})
