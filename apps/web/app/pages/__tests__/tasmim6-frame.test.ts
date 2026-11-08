import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the project frame uses one tab helper', () => {
  it('the governance strip is a level of ProjectWorkspaceTabs', () => {
    expect(existsSync(resolve(app, 'components/pmo/projects/workspace/ProjectGovernanceTabs.vue'))).toBe(false)
    const tabs = read('components/pmo/projects/workspace/ProjectWorkspaceTabs.vue')
    expect(tabs).toContain("level?: 'sections' | 'governance'")
    expect(tabs).toContain('project-governance-tabs')
    const frame = read('pages/projects/[id].vue')
    expect(frame).not.toContain('ProjectGovernanceTabs')
    expect(frame).toContain('level="governance"')
    // The open header of SharedPageHeader: no card, the 64px app tile, the display title, tag pills, a 1px divider under the tabs.
    expect(frame).toContain('liwan-print-hide')
    expect(frame.slice(frame.indexOf('<header'), frame.indexOf('</header>'))).not.toMatch(/ ring ring-default|bg-default|rounded-card/)
    expect(frame).not.toContain('liwan-workspace-head')
    expect(frame).toContain('liwan-app-tile liwan-app-tile-lg')
    expect(frame).toContain('font-display')
    expect(frame).toContain('<SharedHeaderTags :tags="tags" />')
    expect(frame).not.toContain('liwan-page-band')
    expect(frame).not.toContain('<UButton v-if="project && me?.capabilities.includes(\'meetings.read\')"')
    // The sub-strips follow the header's divider; meetings is a tab of the main strip, never a lone link.
    expect(frame.indexOf('level="governance"')).toBeGreaterThan(frame.indexOf('</header>'))
    expect(tabs).toContain('project-tab-meetings')
    expect(frame).not.toContain('-my-2')
  })

  it('the project settings page is a settings page', () => {
    const page = read('pages/projects/[id]/settings.vue')
    expect(page).toContain('<SharedSettingsPage')
    expect(page).not.toContain('<SharedPageContainer')
  })
})
