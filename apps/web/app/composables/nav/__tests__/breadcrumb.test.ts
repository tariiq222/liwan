import { describe, expect, it } from 'vitest'
import { shellBreadcrumb } from '../breadcrumb'
import { shellModuleList } from '../shellModules'

const t = (key: string) => key
const fullRail = shellModuleList().map(({ id, to }) => ({ id, to }))

describe('shell breadcrumb', () => {
  it.each([
    ['/tasks', null, [{ label: 'nav.projects', to: '/projects' }]],
    ['/projects', null, [{ label: 'nav.projects' }]],
    ['/projects/5', 'الملخص', [{ label: 'nav.projects', to: '/projects' }, { label: 'الملخص' }]],
    ['/settings/roles', null, [{ label: 'nav.settings', to: '/settings/users' }]],
    ['/meetings/calendar', null, [{ label: 'nav.meetings', to: '/meetings' }]],
    ['/vendor/overview', null, [{ label: 'nav.management' }]],
    ['/notifications', 'الإشعارات', []],
    ['/tasks', 'nav.tasks', [{ label: 'nav.projects', to: '/projects' }]],
    ['/projects/settings', 'settings.projects.title', [{ label: 'nav.projects', to: '/projects' }]],
    ['/projects', 'nav.projects', []],
    ['/notifications', null, []],
  ] as const)('%s (page title %s)', (path, pageTitle, expected) => {
    expect(shellBreadcrumb({ path, pageTitle, t, rail: fullRail })).toEqual(expected)
  })

  it('never repeats the last label and never links the current page', () => {
    // Before the page registers its heading (server render, first paint) the section's own page already
    // omits the crumb its heading would repeat.
    const crumbs = shellBreadcrumb({ path: '/tasks', pageTitle: null, t, rail: fullRail })
    expect(crumbs.map(crumb => crumb.label)).toEqual(['nav.projects'])
    expect(crumbs.filter(crumb => crumb.label === 'nav.tasks')).toHaveLength(0)
    // With the page heading known, a list page drops the crumb that would repeat it.
    expect(shellBreadcrumb({ path: '/tasks', pageTitle: 'nav.tasks', t, rail: fullRail }).map(crumb => crumb.label)).toEqual(['nav.projects'])
  })

  it('links a module to the visible rail target, not the static module target', () => {
    const rail = fullRail.map(item => item.id === 'settings' ? { ...item, to: '/settings/branding' } : item)
    expect(shellBreadcrumb({ path: '/settings/roles', pageTitle: 'دور', t, rail })).toEqual([{ label: 'nav.settings', to: '/settings/branding' }, { label: 'nav.roles', to: '/settings/roles' }, { label: 'دور' }])
  })

  it('shows no trail on the account page, which is reached from the header menu', () => {
    expect(shellBreadcrumb({ path: '/account', pageTitle: 'الحساب', t, rail: fullRail })).toEqual([])
  })

  it('keeps the module label without a link when the rail hides the module', () => {
    const rail = fullRail.filter(item => item.id !== 'settings')
    expect(shellBreadcrumb({ path: '/settings/branding', pageTitle: 'هوية', t, rail })).toEqual([{ label: 'nav.settings' }, { label: 'settings.branding.title', to: '/settings/branding' }, { label: 'هوية' }])
    expect(shellBreadcrumb({ path: '/settings/branding', pageTitle: null, t, rail })).toEqual([{ label: 'nav.settings' }])
  })
})
