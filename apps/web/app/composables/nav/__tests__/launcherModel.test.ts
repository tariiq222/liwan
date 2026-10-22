import { describe, expect, it } from 'vitest'
import { launcherEntries } from '../launcherModel'
import type { ShellModuleDefinition } from '../shellModules'

const module = (id: string, extra: Partial<ShellModuleDefinition> = {}): ShellModuleDefinition => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, ...extra })
const modules = [module('home', { to: '/' }), module('tasks'), module('projects'), module('chat'), module('ai', { utility: true }), module('settings', { utility: true })]
const names: Record<string, string> = { 'nav.tasks': 'المهام', 'nav.projects': 'المشاريع', 'nav.chat': 'المحادثات', 'nav.ai': 'المساعد' }
const translate = (key: string) => names[key] ?? key

describe('launcher entries', () => {
  it('lists every reachable application, without today and settings, the pinned first in pin order', () => {
    const entries = launcherEntries(modules, ['chat', 'tasks'], '', translate)
    expect(entries.map(entry => entry.id)).toEqual(['chat', 'tasks', 'projects', 'ai'])
    expect(entries.map(entry => entry.pinned)).toEqual([true, true, false, false])
    expect(entries.map(entry => entry.pinIndex)).toEqual([0, 1, null, null])
  })

  it('links the landing path the rail uses and the start page of the application', () => {
    const entry = launcherEntries([module('projects', { to: '/projects/dashboard' })], [], '', translate)[0]!
    expect(entry).toMatchObject({ to: '/projects/dashboard', overviewTo: '/apps/projects' })
  })

  it('cannot pin the utility slot', () => {
    const entries = launcherEntries(modules, [], '', translate)
    expect(entries.find(entry => entry.id === 'ai')?.pinnable).toBe(false)
    expect(entries.filter(entry => entry.pinnable).map(entry => entry.id)).toEqual(['tasks', 'projects', 'chat'])
  })

  it('filters by the translated name and trims the query, and returns nothing for a name nobody has', () => {
    expect(launcherEntries(modules, [], '  المش ', translate).map(entry => entry.id)).toEqual(['projects'])
    expect(launcherEntries(modules, [], 'zzz', translate)).toEqual([])
  })

  it('counts the pin positions among the cards on show when filtered', () => {
    expect(launcherEntries(modules, ['chat', 'tasks', 'projects'], 'ه', translate).map(entry => [entry.id, entry.pinIndex])).toEqual([['tasks', 0]])
    expect(launcherEntries(modules, ['chat', 'tasks', 'projects'], 'ش', translate).map(entry => [entry.id, entry.pinIndex])).toEqual([['projects', 0]])
  })

  it('lists only what the caller passes: an application the user cannot reach never appears', () => {
    expect(launcherEntries(modules.filter(item => item.id !== 'chat'), [], '', translate).map(entry => entry.id)).not.toContain('chat')
  })
})
