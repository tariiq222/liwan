import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// No DOM/component-mount harness exists here (no @nuxt/test-utils, no jsdom),
// so the page contract is asserted against its source, like the shell suite
// and the Task 5 frame suite.
const pagePath = resolve(import.meta.dirname, '../projects/[id]/tasks/index.vue')
const source = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : ''

describe('project tasks section page', () => {
  it('exists so /projects/:id/tasks resolves inside the frame', () => {
    expect(existsSync(pagePath)).toBe(true)
  })

  it('wraps itself in the shared page band', () => {
    // The frame renders its own container; a section child that skips one
    // escapes the list max-width band.
    expect(source).toContain('SharedPageContainer')
  })

  it('picks the board only on ?view=board', () => {
    expect(source).toContain("route.query.view === 'board'")
    expect(source.match(/<TaskTable\b[^>]*>/s)?.[0]).toContain('v-if="!isBoard"')
    expect(source.match(/<TaskBoard\b[^>]*>/s)?.[0]).toContain('v-else')
  })

  it('reads and writes the list filters through the shared query helpers', () => {
    // Sharing these with /projects/:id/tasks/:taskId keeps one vue-query key.
    expect(source).toContain('projectTaskParams(')
    expect(source).toContain('projectTaskQuery(')
  })

  it('links a task row to a sibling path and carries no returnTo', () => {
    expect(source).toContain('`/projects/${projectId.value}/tasks/${taskId}`')
    // The section path already says where a close returns to.
    expect(source).not.toContain('returnTo')
  })

  it('derives record and create links from one explicit filter query', () => {
    // Ruling 2: no taskTo(0) sentinel, and no defineExpose kept alive for a
    // mount-based test this repo cannot run.
    expect(source).toMatch(/const filterQuery = computed[<(]/)
    const openCreate = source.match(/function openCreate\(\)[\s\S]*?\n}/)?.[0]
    expect(openCreate).toBeDefined()
    expect(openCreate).toContain('filterQuery')
    expect(openCreate).not.toContain('taskTo(')
    expect(source).not.toContain('defineExpose')
    // `view` is this page's presentation choice, not a list filter.
    expect(source).toContain('view: _view')
  })

  it('leaves the only h1 to the frame and registers the shell title itself', () => {
    expect(source).not.toContain('<h1')
    expect(source).not.toContain('SharedPageHeader')
    expect(source).toContain("usePageHeader(() => t('nav.projectTasks'))")
  })

  it('keeps the create button inert until hydration and uses logical spacing', () => {
    expect(source).toContain('useHydrated()')
    expect(source).toContain(':disabled="!hydrated"')
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-\d/)
    expect(source).not.toMatch(/\b(?:left|right)-\d/)
  })
})
