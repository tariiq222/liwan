import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// This repo's component tests read source text rather than mounting components
// (see shell/__tests__/shellStructure.test.ts): there is no DOM environment
// configured and @nuxt/test-utils/runtime is not installed.
const source = readFileSync(
  resolve(import.meta.dirname, '../ProjectWorkspaceTabs.vue'),
  'utf8',
)

describe('ProjectWorkspaceTabs', () => {
  it('renders exactly one flat tab strip', () => {
    expect(source.match(/overflow-x-auto border-b border-default/g)).toHaveLength(1)
    expect(source).toContain('data-testid="project-workspace-tabs"')
  })

  it('never renders the old two-row group/sub-tab structure', () => {
    expect(source).not.toContain('project-workspace-subtabs')
    expect(source).not.toContain('nasq-ui-subtab-row')
    expect(source).not.toContain('activeGroup')
    expect(source).not.toContain('projectWorkspaceGroups')
  })

  it('sources its sections and active state from the shared nav composables', () => {
    expect(source).toContain("import { projectSections } from '@/composables/nav/projectSections'")
    expect(source).toContain("import { activeProjectSection } from '@/composables/nav/activeRoute'")
  })

  it('templates each tab id from the section id', () => {
    expect(source).toContain('project-tab-${section.id}')
  })
})
