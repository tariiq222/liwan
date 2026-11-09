import { describe, expect, it } from 'vitest'
import { sidebarApp, sidebarMode } from '../sidebarMode'

const rail = ['home', 'ai', 'crm', 'tasks', 'settings']

describe('sidebar mode', () => {
  it('is global on the day page, the start pages and pages no application owns', () => {
    for (const module of ['home', 'apps', null]) expect(sidebarApp(false, module, rail)).toBeNull()
    expect(sidebarMode(null)).toBe('global')
  })

  it('shows the open application, or settings, as that application own menu', () => {
    expect(sidebarApp(false, 'crm', rail)).toBe('crm')
    expect(sidebarApp(false, 'settings', rail)).toBe('settings')
    expect(sidebarMode('crm')).toBe('app')
  })

  it('treats the self-service pages as their own area, whatever module claims the path', () => {
    expect(sidebarApp(true, null, rail)).toBe('account')
    expect(sidebarApp(true, 'crm', rail)).toBe('account')
  })

  it('stays global for a module the user cannot reach', () => {
    expect(sidebarApp(false, 'finance', rail)).toBeNull()
  })
})
