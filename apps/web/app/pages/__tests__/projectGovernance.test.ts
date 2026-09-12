import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-text assertions: this repo has no DOM/component-mount harness.
const pagePath = resolve(import.meta.dirname, '../projects/[id]/governance.vue')
const source = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : ''
const locale = (lang: string) => JSON.parse(
  readFileSync(resolve(import.meta.dirname, `../../../i18n/locales/${lang}/projects.json`), 'utf8'),
).projects.governance as Record<string, unknown>

const HINTS = ['charterHint', 'stakeholdersHint', 'raciHint', 'risksHint']

describe('project governance index page', () => {
  it('exists so /projects/:id/governance resolves inside the frame', () => {
    expect(existsSync(pagePath)).toBe(true)
  })

  it('wraps itself in the shared page band', () => {
    expect(source).toContain('SharedPageContainer')
  })

  it('links to the four governance sections in order', () => {
    const segments = [...source.matchAll(/segment: '([^']+)'/g)].map(m => m[1])
    expect(segments).toEqual(['charter', 'stakeholders', 'raci', 'register'])
    expect(source).toContain('`/projects/${projectId}/${card.segment}`')
  })

  it('guards the whole list with one capability check', () => {
    // Ruling 3: the four cards need the same capability, so a per-item filter
    // would imply a difference between them that does not exist.
    expect(source).not.toMatch(/\.filter\(/)
    expect(source).toContain("hasCapability(me.value, 'pmo.projects.read')")
    expect(source).toMatch(/v-if="canRead"/)
  })

  it('labels and describes every card through the locale files', () => {
    expect(source).toContain('t(card.labelKey)')
    expect(source).toContain('t(card.descriptionKey)')
    for (const hint of HINTS) expect(source).toContain(`projects.governance.${hint}`)
    for (const lang of ['ar', 'en']) {
      const governance = locale(lang)
      for (const hint of HINTS) expect(typeof governance[hint], `${lang}.${hint}`).toBe('string')
    }
  })

  it('leaves the only h1 to the frame and registers the shell title itself', () => {
    expect(source).not.toContain('<h1')
    expect(source).not.toContain('SharedPageHeader')
    expect(source).toContain("usePageHeader(() => t('projects.workspace.groups.governance'))")
  })

  it('hides the decorative card icon from assistive technology', () => {
    expect(source.match(/<UIcon\b[^>]*>/s)?.[0]).toContain('aria-hidden="true"')
  })

  it('uses logical spacing only', () => {
    expect(source).toMatch(/<NuxtLink/)
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-\d/)
    expect(source).not.toMatch(/\b(?:left|right)-\d/)
  })
})
