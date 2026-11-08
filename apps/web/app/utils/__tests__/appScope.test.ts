import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appScopeFor } from '../appScope'

describe('appScopeFor', () => {
  it('a page inside an application wears that application, so a slide-over opened there gets its identity', () => {
    expect(appScopeFor('/projects/1/tasks', 'projects')).toBe('projects')
    expect(appScopeFor('/projects/new', 'projects')).toBe('projects')
    expect(appScopeFor('/crm/opportunities', 'crm')).toBe('crm')
  })

  it('an application settings page takes that application, not «settings»', () => {
    expect(appScopeFor('/settings/apps/projects', 'settings')).toBe('projects')
    expect(appScopeFor('/settings/apps/hr/leave', 'settings')).toBe('hr')
    expect(appScopeFor('/settings/company', 'settings')).toBe('settings')
  })

  it('pages with no module (home, search, account) have none, so their overlays stay ink', () => {
    expect(appScopeFor('/', null)).toBeUndefined()
    expect(appScopeFor('/search', undefined)).toBeUndefined()
  })

  it('the default layout puts the scope on <html>, where every teleported overlay inherits it', () => {
    const layout = readFileSync(resolve(import.meta.dirname, '../../layouts/default.vue'), 'utf8')
    expect(layout).toContain("useHead(() => ({ htmlAttrs: { 'data-app': appScope.value } }))")
    expect(layout).not.toContain(':data-app')
  })
})
