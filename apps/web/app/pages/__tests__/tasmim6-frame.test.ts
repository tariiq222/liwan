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
    expect(frame).toContain('webvue-page-band webvue-print-hide')
    expect(frame).toContain('width="list" class="webvue-print-hide"')
    expect(frame).not.toContain('-my-2')
  })

  it('the project settings page is a settings page', () => {
    const page = read('pages/projects/[id]/settings.vue')
    expect(page).toContain('<SharedSettingsPage')
    expect(page).not.toContain('<SharedPageContainer')
  })
})
