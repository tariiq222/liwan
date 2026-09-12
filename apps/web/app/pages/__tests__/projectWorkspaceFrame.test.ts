import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// This repo has no DOM/component-mount harness (no @nuxt/test-utils, no jsdom),
// so page structure is asserted against the source the way the shell suite does.
const pages = resolve(import.meta.dirname, '..')
const framePath = resolve(pages, 'projects/[id].vue')
const summaryPath = resolve(pages, 'projects/[id]/index.vue')
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
