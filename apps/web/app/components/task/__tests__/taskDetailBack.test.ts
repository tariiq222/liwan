import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The repo has no DOM environment and no @nuxt/test-utils, so every component
// test asserts on source text. This one guards the deletion of the route-backed
// sheet: nothing may reappear that hides a record's own way back.
const panelFile = resolve(import.meta.dirname, '../TaskDetailPanel.vue')
const panel = readFileSync(panelFile, 'utf8')

function backLinkTag(source: string): string | undefined {
  return source.match(/<NuxtLink[^>]*t\('tasks\.detail\.back'\)[^>]*>/)?.[0]
}

describe('task detail back link', () => {
  it('renders unconditionally, with no overlay injection left to suppress it', () => {
    expect(panel).not.toMatch(/PROJECT_OVERLAY_INJECTION_KEY|projectOverlayRoute|inProjectOverlay/)

    const backLink = backLinkTag(panel)
    expect(backLink, 'the back link must still exist').toBeTruthy()
    expect(backLink).toContain(':to="backTo"')
    expect(backLink, 'the back link must not be conditional').not.toMatch(/\sv-(?:if|else-if|show)[=\s>]/)
  })

  it('keeps prev/next sibling navigation driven by siblingParams', () => {
    expect(panel).toContain('const siblings = useTaskSiblings(idRef, filterParams)')
    expect(panel).toContain("props.siblingParams ?? localFilters!.value")
    expect(panel).toContain("e.key === 'j' || e.key === 'J') goTo(siblings.value.nextId)")
    expect(panel).toContain("e.key === 'k' || e.key === 'K') goTo(siblings.value.prevId)")
  })
})
