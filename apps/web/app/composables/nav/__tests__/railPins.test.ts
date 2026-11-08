import { describe, expect, it } from 'vitest'
import { MAX_RAIL_PINS, pinnedApplications, railPinsOwner, resolveRailPins, savedRailPins, toggleRailPin } from '../railPins'
import type { ShellRailModel } from '../sidebarModel'

const apps = ['tasks', 'projects', 'crm', 'chat', 'hr', 'finance', 'operations', 'inbox']
const item = (id: string) => ({ id, labelKey: id, icon: 'i-lucide-box', to: `/${id}` })
const rail = (): ShellRailModel => {
  const applications = apps.map(item)
  return { core: [item('home'), item('meetings')], applications, utility: [item('settings')], all: applications }
}

describe('rail pins', () => {
  it('starts someone who never pinned with every permitted application up to the pin limit', () => {
    expect(resolveRailPins(apps.slice(0, 3), null)).toEqual(['tasks', 'projects', 'crm'])
    expect(resolveRailPins(apps, null)).toEqual(apps.slice(0, MAX_RAIL_PINS))
  })
  it('keeps a saved empty choice, drops lost permissions and duplicates, and caps the list', () => {
    expect(resolveRailPins(apps, [])).toEqual([])
    expect(resolveRailPins(['tasks'], ['finance', 'tasks', 'tasks'])).toEqual(['tasks'])
    expect(resolveRailPins([...apps, 'appointments'], [...apps, 'appointments'])).toHaveLength(MAX_RAIL_PINS)
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
  it('lists only the pinned applications in manifest order, never a core application, settings or an unpinned application', () => {
    const list = pinnedApplications(rail(), ['hr', 'tasks', 'meetings'])
    expect(list.map(entry => entry.id)).toEqual(['tasks', 'hr'])
    expect(pinnedApplications(rail(), [])).toEqual([])
  })
})
