import { describe, expect, it } from 'vitest'
import { applicationNavigation } from '../applicationNavigation'
import { contextLinksForModule } from '../shellModules'
import { isContextLinkActive } from '../../useShellNavigation'

const identity = { capabilities: ['liwan.internal', 'meetings.read', 'meetings.create', 'operations.requests.read', 'operations.requests.create'] }
const route = (path = '/meetings', query: Record<string, unknown> = {}) => ({ path, fullPath: path, query, params: {} })
const build = (path = '/meetings', query: Record<string, unknown> = {}, actor = identity) => applicationNavigation({
  identity: actor, route: route(path, query), activeId: path.startsWith('/meetings') ? 'meetings' : 'operations',
  contextLinks: contextLinksForModule(path.startsWith('/meetings') ? 'meetings' : 'operations', actor, path).map(link => ({ ...link, active: link.to === path })),
  translate: key => key,
})

describe('shared section hierarchy across applications', () => {
  const buildModule = (module: string, path: string, capabilities: string[], query: Record<string, unknown> = {}) => {
    const actor = { capabilities }
    return applicationNavigation({ identity: actor, route: route(path, query), activeId: module, contextLinks: contextLinksForModule(module, actor, path).map(link => ({ ...link, active: isContextLinkActive(path, link) })), translate: key => key }).find(item => item.id === module)!
  }
  const finance = ['liwan.internal', 'finance.invoices.read', 'finance.partners.read', 'finance.entries.read', 'finance.accounts.read', 'finance.statements.read', 'finance.reports.read', 'finance.analytic.read', 'finance.budgets.read', 'finance.zakat.read']
  const hr = ['liwan.internal', 'hr.employees.read', 'hr.employees.manage', 'hr.departments.read', 'hr.recruitment.read', 'hr.leave.read', 'hr.leave.approve', 'hr.shifts.read', 'hr.onboarding.read', 'hr.offboarding.read', 'hr.assets.read']
  const settings = ['liwan.internal', 'settings.company.read', 'settings.branding.manage', 'access.users.read', 'access.roles.read', 'access.users.assign_roles', 'access.audit.read']

  it('builds unopened finance siblings from their own manifest sections without flattening or changing destinations', () => {
    const menu = buildModule('finance', '/finance', finance)
    const rows = menu.sections.flatMap(section => section.items)
    expect(rows.find(row => row.id === 'finance-sales')?.children?.map(child => child.to)).toEqual(['/finance/sales/invoices', '/finance/sales/credit-notes', '/finance/partners?kind=customer'])
    expect(rows.find(row => row.id === 'finance-purchases')?.children?.map(child => child.to)).toEqual(['/finance/purchases/bills', '/finance/purchases/refunds', '/finance/partners?kind=vendor'])
    expect(rows.find(row => row.id === 'finance-accounting')?.children?.map(child => child.to)).toEqual(['/finance/accounting/entries', '/finance/accounting/accounts'])
    expect(rows.find(row => row.id === 'finance-reports')?.children?.some(child => child.to === '/finance/reports/vat')).toBe(true)
    expect(rows.some(row => row.id === 'sales-invoices')).toBe(false)
  })
  it('puts every permitted HR area below its parent and does not invent restricted payroll links', () => {
    const menu = buildModule('hr', '/hr', hr)
    const rows = menu.sections.flatMap(section => section.items)
    expect(rows.find(row => row.id === 'section-people')?.children?.map(child => child.to)).toContain('/hr/departments')
    expect(rows.find(row => row.id === 'section-hiring')?.children?.map(child => child.to)).toEqual(['/hr/recruitment', '/hr/recruitment/jobs'])
    expect(rows.find(row => row.id === 'section-time')?.children?.map(child => child.to)).toEqual(['/hr/leave', '/hr/shifts'])
    expect(rows.some(row => row.id === 'employees' || row.id === 'section-pay')).toBe(false)
  })
  it('keeps settings anchors while nesting user list presets below Users', () => {
    const menu = buildModule('settings', '/settings/team/users', settings, { status: 'stopped' })
    const team = menu.sections.flatMap(section => section.items).find(row => row.id === 'settings-team')!
    const users = team.children?.find(child => child.id === 'users')
    expect(users?.to).toEqual({ path: '/settings/team', hash: '#users' })
    expect(users?.children?.some(child => JSON.stringify(child.to) === JSON.stringify({ path: '/settings/team', hash: '#users' }))).toBe(true)
    expect(users?.children?.find(child => child.id === 'stopped')).toMatchObject({ active: true, to: { path: '/settings/team/users', query: { status: 'stopped' } } })
    const company = menu.sections.flatMap(section => section.items).find(row => row.id === 'settings-company')!
    expect(company.children?.some(child => JSON.stringify(child.to) === JSON.stringify({ path: '/settings/company', hash: '#branding' }))).toBe(true)
  })
  it('retains a permitted child when its section parent is filtered out, without exposing that parent destination', () => {
    const menu = buildModule('finance', '/finance/sales/invoices', ['liwan.internal', 'finance.partners.read'])
    const rows = menu.sections.flatMap(section => section.items)
    const destinations = rows.flatMap(row => [row.to, ...(row.children?.map(child => child.to) ?? [])])
    expect(destinations).toContain('/finance/partners?kind=customer')
    expect(destinations).not.toContain('/finance/sales/invoices')
    expect(destinations).not.toContain('/finance/purchases/bills')
  })
  it('discovers permitted children of unopened denied parents without exposing denied destinations', () => {
    const partners = buildModule('finance', '/finance/partners', ['liwan.internal', 'finance.partners.read'])
    const financeTargets = partners.sections.flatMap(section => section.items).flatMap(row => [row.to, ...(row.children?.map(child => child.to) ?? [])])
    expect(financeTargets).toContain('/finance/partners?kind=customer')
    expect(financeTargets).toContain('/finance/partners?kind=vendor')
    expect(financeTargets).not.toContain('/finance/sales/invoices')
    expect(financeTargets).not.toContain('/finance/purchases/bills')
    const people = buildModule('hr', '/hr', ['liwan.internal', 'hr.employees.read', 'hr.shifts.read'])
    const hrTargets = people.sections.flatMap(section => section.items).flatMap(row => [row.to, ...(row.children?.map(child => child.to) ?? [])])
    expect(hrTargets).toContain('/hr/shifts')
    expect(hrTargets).not.toContain('/hr/leave')
  })
  it('keeps the routed customer or vendor child selected across section boundaries', () => {
    for (const kind of ['customer', 'vendor']) {
      const menu = buildModule('finance', '/finance/partners', finance, { kind })
      const rows = menu.sections.flatMap(section => section.items)
      const selected = rows.flatMap(row => row.children ?? [row]).filter(row => row.active)
      expect(selected.map(row => row.to)).toEqual([`/finance/partners?kind=${kind}`])
    }
  })
  it('nests the document archive only when permitted and otherwise retains a direct link', () => {
    const capabilities = ['liwan.internal', 'documents.items.read']
    const direct = buildModule('documents', '/documents', capabilities).sections.flatMap(section => section.items).find(row => row.id === 'documents')!
    expect(direct.to).toBe('/documents')
    expect(direct.children).toBeUndefined()
    const archived = buildModule('documents', '/documents', [...capabilities, 'documents.items.archive'], { archived: '1' }).sections.flatMap(section => section.items).find(row => row.id === 'documents')!
    expect(archived.children?.find(row => row.id === 'archived-documents')).toMatchObject({ active: true, to: { path: '/documents', query: { archived: '1' } } })
  })
})

describe('unified application navigation', () => {
  it('keeps all meeting destinations flat inside their application with one primary create action', () => {
    const item = build().find(item => item.id === 'meetings')!
    expect(item).toBeDefined()
    expect(item.sections.flatMap(section => section.items.map(row => row.id))).toEqual(['meetings', 'my-meetings', 'meeting-followup', 'meeting-calendar', 'meeting-series'])
    expect(item.sections.flatMap(section => section.items).every(row => !row.children)).toBe(true)
    expect(item.actions.filter(action => typeof action.to === 'object' && action.to.path === '/meetings/new')).toHaveLength(1)
    expect(item.actions[0]).toMatchObject({ id: 'new-meeting', primary: true })
  })
  it('does not carry an operations filter into an unopened meetings menu', () => {
    const item = build('/operations', { state: 'done', mine: '1', project_id: '99' }).find(item => item.id === 'meetings')!
    expect(item.active).toBe(false)
    const rows = item.sections.flatMap(section => section.items)
    expect(rows.find(row => row.id === 'my-meetings')?.active).toBe(false)
    const create = item.actions.find(action => action.id === 'new-meeting')!
    expect(create.to).toEqual({ path: '/meetings/new', query: { returnTo: '/meetings' } })
  })
  it('keeps creation and unavailable applications out of a read-only menu', () => {
    const items = build('/meetings', {}, { capabilities: ['liwan.internal', 'meetings.read'] })
    const meetings = items.find(item => item.id === 'meetings')!
    expect(meetings.actions).toEqual([])
    expect(items.some(item => item.id === 'operations')).toBe(false)
  })
  it('lights my-meetings only when mine=1 is active, and keeps meetings lit on other filters', () => {
    const mine = build('/meetings', { mine: '1' }).find(item => item.id === 'meetings')!
    expect(mine.sections.flatMap(section => section.items).filter(row => row.active).map(row => row.id)).toEqual(['my-meetings'])
    const filtered = build('/meetings', { state: 'done' }).find(item => item.id === 'meetings')!
    expect(filtered.sections.flatMap(section => section.items).filter(row => row.active).map(row => row.id)).toEqual(['meetings'])
  })
  it('renders arrived sidebar counts on meetings rows', () => {
    const item = applicationNavigation({
      identity, route: route('/meetings'), activeId: 'meetings',
      contextLinks: contextLinksForModule('meetings', identity, '/meetings'),
      sidebarCounts: { meetings: 12, 'my-meetings': 4, 'meeting-followup': 2 },
      translate: key => key,
    }).find(entry => entry.id === 'meetings')!
    const counts = item.sections.flatMap(section => section.items).filter(row => row.count !== undefined).map(row => [row.id, row.count])
    expect(counts).toEqual([['meetings', 12], ['my-meetings', 4], ['meeting-followup', 2]])
  })
  it('reaches its one destination from the sidebar', () => {
    // /work is the application's landing page and its only nav row since the pages merged; the sidebar shows it once
    // as the row itself and once as the work-space entry the shell adds for any module with a landing page.
    const actor = { capabilities: ['liwan.internal', 'tasks.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/work'), activeId: 'tasks', contextLinks: contextLinksForModule('tasks', actor, '/work'), translate: key => key }).find(item => item.id === 'tasks')!
    const links = item.sections.flatMap(section => section.items)
    expect(links.some(link => link.to === '/work' || (link.to as { path?: string })?.path === '/work')).toBe(true)
    expect(item.to).toBe('/work')
  })
  it('keeps the tasks tab and list query when the sidebar links to its landing page', () => {
    const actor = { capabilities: ['liwan.internal', 'tasks.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/work', { view: 'tasks', q: 'test' }), activeId: 'tasks', contextLinks: contextLinksForModule('tasks', actor, '/work'), translate: key => key }).find(item => item.id === 'tasks')!
    const landing = item.sections.flatMap(section => section.items).find(link => link.label === 'nav.viewAll')!
    expect(landing).toBeDefined()
    expect(JSON.stringify(landing.to)).toContain('/work')
  })
})

describe('the flat projects menu', () => {
  const actor = { capabilities: ['liwan.internal', 'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create'] }
  const projectsMenu = (path: string, query: Record<string, unknown> = {}, extra: Partial<Parameters<typeof applicationNavigation>[0]> = {}, identity = actor) =>
    applicationNavigation({ identity, route: route(path, query), activeId: 'projects', contextLinks: contextLinksForModule('projects', identity, path), translate: key => key, ...extra }).find(item => item.id === 'projects')!
  const rows = (item: ReturnType<typeof projectsMenu>) => item.sections.flatMap(section => section.items)

  it('lists one level of pages with the create action first and no branches', () => {
    const item = projectsMenu('/projects')
    expect(item.actions.map(action => action.id)).toEqual(['new-project'])
    expect(item.actions[0]).toMatchObject({ primary: true, to: { path: '/projects/new', query: { returnTo: '/projects' } } })
    expect(rows(item).map(row => row.id)).toEqual(['project-dashboard', 'projects', 'tasks', 'projects-attention'])
    expect(rows(item).every(row => !row.children)).toBe(true)
  })
  it('points my tasks at the assigned list and needs attention at the combined status filter', () => {
    const item = projectsMenu('/projects')
    expect(rows(item).find(row => row.id === 'tasks')?.to).toEqual({ path: '/tasks', query: { assignee: 'me' } })
    expect(rows(item).find(row => row.id === 'projects-attention')?.to).toEqual({ path: '/projects', query: { status: 'attention' } })
  })
  it('lights the projects row on the list and needs attention on its preset, never both', () => {
    expect(rows(projectsMenu('/projects')).filter(row => row.active).map(row => row.id)).toEqual(['projects'])
    expect(rows(projectsMenu('/projects', { mine: '1', status: 'done' })).filter(row => row.active).map(row => row.id)).toEqual(['projects'])
    expect(rows(projectsMenu('/projects', { status: 'attention' })).filter(row => row.active).map(row => row.id)).toEqual(['projects-attention'])
    expect(rows(projectsMenu('/projects/dashboard')).filter(row => row.active).map(row => row.id)).toEqual(['project-dashboard'])
    expect(rows(projectsMenu('/tasks/', { assignee: 'me' })).filter(row => row.active).map(row => row.id)).toEqual(['tasks'])
  })
  it('keeps the chosen layout when a row leads to the page that is open', () => {
    expect(rows(projectsMenu('/tasks', { view: 'board', assignee: 'me' })).find(row => row.id === 'tasks')?.to).toEqual({ path: '/tasks', query: { assignee: 'me', view: 'board' } })
    expect(rows(projectsMenu('/projects', { view: 'table', status: 'done' })).find(row => row.id === 'projects')?.to).toEqual({ path: '/projects', query: { view: 'table' } })
    expect(rows(projectsMenu('/projects/dashboard', { view: 'board' })).find(row => row.id === 'tasks')?.to).toEqual({ path: '/tasks', query: { assignee: 'me' } })
  })
  it('draws only the counts that have arrived and the recent projects under their own heading', () => {
    const item = projectsMenu('/projects/7/tasks', {}, { sidebarCounts: { projects: 12, 'projects-attention': 0 }, recents: [{ id: 7, name: 'ألفا' }, { id: 3, name: 'بيتا' }] })
    expect(rows(item).filter(row => row.count !== undefined).map(row => [row.id, row.count])).toEqual([['projects', 12], ['projects-attention', 0]])
    const recent = item.sections.find(section => section.title === 'nav.recentProjects')!
    expect(recent.items.map(row => [row.label, row.to, row.active])).toEqual([['ألفا', '/projects/7', true], ['بيتا', '/projects/3', false]])
    expect(item.sections.filter(section => section.title).length).toBe(1)
  })
  it('omits the heading without recent projects and every row the person may not open', () => {
    const item = projectsMenu('/projects', {}, {}, { capabilities: ['liwan.internal', 'pmo.projects.read'] })
    expect(item.sections.length).toBe(1)
    expect(rows(item).map(row => row.id)).toEqual(['project-dashboard', 'projects', 'projects-attention'])
    expect(item.actions).toEqual([])
  })
})
