import { describe, expect, it } from 'vitest'
import { MAX_RAIL_PINS, pinnedRail, railPinsOwner, resolveRailPins, savedRailPins, toggleRailPin } from '../railPins'
import type { ShellRailModel } from '../sidebarModel'

const apps = ['tasks', 'projects', 'meetings', 'chat', 'hr', 'finance', 'documents', 'inbox']
const item = (id: string) => ({ id, labelKey: id, icon: 'i-lucide-box', to: `/${id}` })
const rail = (): ShellRailModel => {
  const applications = apps.map(item)
  return { top: [item('apps')], applications, utility: [item('settings')], all: applications, drawer: applications }
}

describe('rail pins', () => {
  it('starts someone who never pinned with the first four permitted applications', () => {
    expect(resolveRailPins(apps, null)).toEqual(['tasks', 'projects', 'meetings', 'chat'])
  })
  it('keeps a saved empty choice, drops lost permissions and duplicates, and caps the list', () => {
    expect(resolveRailPins(apps, [])).toEqual([])
    expect(resolveRailPins(['tasks'], ['finance', 'tasks', 'tasks'])).toEqual(['tasks'])
    expect(resolveRailPins([...apps, 'crm'], [...apps, 'crm'])).toHaveLength(MAX_RAIL_PINS)
  })
  it('ignores pins saved by another person or company', () => {
    const cookie = { owner: railPinsOwner(1, 2)!, ids: ['hr'] }
    expect(savedRailPins(cookie, '1:2')).toEqual(['hr'])
    expect(savedRailPins(cookie, '1:3')).toBeNull()
    expect(savedRailPins(cookie, null)).toBeNull()
    expect(railPinsOwner(undefined, 2)).toBeNull()
  })
  it('toggles a pin and refuses a seventh', () => {
    expect(toggleRailPin(['tasks'], 'hr')).toEqual(['tasks', 'hr'])
    expect(toggleRailPin(['tasks', 'hr'], 'tasks')).toEqual(['hr'])
    expect(toggleRailPin(apps.slice(0, MAX_RAIL_PINS), 'inbox')).toEqual(apps.slice(0, MAX_RAIL_PINS))
  })
  it('shows pins in manifest order plus the open application, and leaves the drawer and breadcrumb sources whole', () => {
    const model = pinnedRail(rail(), ['hr', 'tasks'], 'inbox')
    expect(model.applications.map(entry => entry.id)).toEqual(['tasks', 'hr', 'inbox'])
    expect(model.drawer).toHaveLength(apps.length)
    expect(model.all).toHaveLength(apps.length)
  })
})
