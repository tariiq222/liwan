import { describe, expect, it } from 'vitest'
import { shellBreadcrumb } from '../breadcrumb'
import { shellModuleList } from '../shellModules'

const t = (key: string) => key
const fullRail = shellModuleList().map(({ id, to }) => ({ id, to }))

describe('shell breadcrumb', () => {
  it.each([
    ['/tasks', null, [{ label: 'nav.projects', to: '/projects' }, { label: 'nav.tasks' }]],
    ['/projects', null, [{ label: 'nav.projects' }]],
    ['/projects/5', 'الملخص', [{ label: 'nav.projects', to: '/projects' }, { label: 'الملخص' }]],
    ['/settings/roles', null, [{ label: 'nav.settings', to: '/settings/users' }, { label: 'nav.roles' }]],
    ['/meetings/calendar', null, [{ label: 'nav.meetings', to: '/meetings' }, { label: 'nav.meetingCalendar' }]],
    ['/vendor/overview', null, [{ label: 'nav.management' }]],
    ['/notifications', 'الإشعارات', [{ label: 'الإشعارات' }]],
    ['/notifications', null, []],
  ] as const)('%s (page title %s)', (path, pageTitle, expected) => {
    expect(shellBreadcrumb({ path, pageTitle, t, rail: fullRail })).toEqual(expected)
  })

  it('never repeats the last label and never links the current page', () => {
    const crumbs = shellBreadcrumb({ path: '/tasks', pageTitle: 'nav.tasks', t, rail: fullRail })
    expect(crumbs.at(-1)).toEqual({ label: 'nav.tasks' })
    expect(crumbs.filter(crumb => crumb.label === 'nav.tasks')).toHaveLength(1)
  })

  it('links a module to the visible rail target, not the static module target', () => {
    const rail = fullRail.map(item => item.id === 'settings' ? { ...item, to: '/settings/branding' } : item)
    expect(shellBreadcrumb({ path: '/account', pageTitle: 'الحساب', t, rail })).toEqual([{ label: 'nav.settings', to: '/settings/branding' }, { label: 'الحساب' }])
  })

  it('keeps the module label without a link when the rail hides the module', () => {
    const rail = fullRail.filter(item => item.id !== 'settings')
    expect(shellBreadcrumb({ path: '/account', pageTitle: 'الحساب', t, rail })).toEqual([{ label: 'nav.settings' }, { label: 'الحساب' }])
    expect(shellBreadcrumb({ path: '/settings/branding', pageTitle: null, t, rail })).toEqual([{ label: 'nav.settings' }, { label: 'settings.branding.title' }])
  })
})
