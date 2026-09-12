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
    const taskTo = source.match(/function taskTo\([\s\S]*?\n}/)?.[0]
    expect(taskTo).toBeDefined()
    expect(taskTo).toContain('`/projects/${projectId.value}/tasks/${taskId}`')
    expect(taskTo).toContain('filterQuery.value')
    // The section path already says where a close returns to, so no outbound
    // link may be built through the returnTo query helper.
    expect(source).not.toContain('returnToQuery')
  })

  it('escapes an unusable project id instead of querying with a blank one', () => {
    // /projects/abc/tasks still mounts this page: <NuxtPage/> is unconditional
    // and useProject is merely disabled, so without this branch TaskTable would
    // ask the server for project_id= and take a 422.
    expect(source).toContain('projectId.value === null')
    const panel = source.match(/<div v-if="notFound"[\s\S]*?<\/div>/)?.[0]
    expect(panel).toBeDefined()
    expect(panel).toContain("t('projects.notFound')")
    expect(panel).toContain("t('projects.backToProjects')")
    // The list may only render once that branch has ruled a null id out.
    expect(source).toContain('<SharedPageState v-else-if="error"')
    expect(source.match(/<section v-else\b/)?.[0]).toBeDefined()
  })

  it('gates create on the task capability, not on project ownership', () => {
    // This is the one section page where a capability rather than can_manage
    // decides creation; widening it would be a security-relevant regression.
    const canCreate = source.match(/const canCreate = computed\([\s\S]*?\n/)?.[0]
    expect(canCreate).toBeDefined()
    expect(canCreate).toContain("can('pmo.tasks.create')")
    expect(canCreate).toContain('active')
    expect(canCreate).not.toContain('can_manage')
    const row = source.match(/<div v-if="canCreate"[\s\S]*?<\/div>/)?.[0]
    expect(row).toBeDefined()
    expect(row).toContain('data-testid="project-header-create"')
    expect(row).toContain(':disabled="!hydrated"')
  })

  it('gives the board the project stages', () => {
    // TaskBoard falls back to {kind:'personal'} when stageSource is omitted, so
    // dropping this prop would silently render personal stages on a project.
    expect(source.match(/<TaskBoard\b[^>]*>/s)?.[0]).toContain(':stage-source="stageSource"')
    expect(source).toContain("kind: 'project' as const")
  })

  it('keeps a way out to the archived tasks of this project', () => {
    const link = source.match(/<NuxtLink\b[^>]*>/s)?.[0]
    expect(link).toBeDefined()
    expect(link).toContain("path: '/archived-tasks'")
    expect(link).toContain('project_id: projectId')
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
