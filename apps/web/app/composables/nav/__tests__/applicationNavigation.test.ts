import { describe, expect, it } from 'vitest'
import { applicationNavigation } from '../applicationNavigation'
import { contextLinksForModule } from '../shellModules'
import { isContextLinkActive } from '../../useShellNavigation'

const identity = { capabilities: ['webvue.internal', 'meetings.read', 'meetings.create', 'operations.requests.read', 'operations.requests.create'] }
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
  const finance = ['webvue.internal', 'finance.invoices.read', 'finance.partners.read', 'finance.entries.read', 'finance.accounts.read', 'finance.statements.read', 'finance.reports.read', 'finance.analytic.read', 'finance.budgets.read', 'finance.zakat.read']
  const hr = ['webvue.internal', 'hr.employees.read', 'hr.employees.manage', 'hr.departments.read', 'hr.recruitment.read', 'hr.leave.read', 'hr.leave.approve', 'hr.shifts.read', 'hr.onboarding.read', 'hr.offboarding.read', 'hr.assets.read']
  const settings = ['webvue.internal', 'settings.company.read', 'settings.branding.manage', 'access.users.read', 'access.roles.read', 'access.users.assign_roles', 'access.audit.read']

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
    expect(menu.views).toEqual([])
  })
  it('retains a permitted child when its section parent is filtered out, without exposing that parent destination', () => {
    const menu = buildModule('finance', '/finance/sales/invoices', ['webvue.internal', 'finance.partners.read'])
    const rows = menu.sections.flatMap(section => section.items)
    const destinations = rows.flatMap(row => [row.to, ...(row.children?.map(child => child.to) ?? [])])
    expect(destinations).toContain('/finance/partners?kind=customer')
    expect(destinations).not.toContain('/finance/sales/invoices')
    expect(destinations).not.toContain('/finance/purchases/bills')
  })
  it('discovers permitted children of unopened denied parents without exposing denied destinations', () => {
    const partners = buildModule('finance', '/finance/partners', ['webvue.internal', 'finance.partners.read'])
    const financeTargets = partners.sections.flatMap(section => section.items).flatMap(row => [row.to, ...(row.children?.map(child => child.to) ?? [])])
    expect(financeTargets).toContain('/finance/partners?kind=customer')
    expect(financeTargets).toContain('/finance/partners?kind=vendor')
    expect(financeTargets).not.toContain('/finance/sales/invoices')
    expect(financeTargets).not.toContain('/finance/purchases/bills')
    const people = buildModule('hr', '/hr', ['webvue.internal', 'hr.employees.read', 'hr.shifts.read'])
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
    const capabilities = ['webvue.internal', 'documents.items.read']
    const direct = buildModule('documents', '/documents', capabilities).sections.flatMap(section => section.items).find(row => row.id === 'documents')!
    expect(direct.to).toBe('/documents')
    expect(direct.children).toBeUndefined()
    const archived = buildModule('documents', '/documents', [...capabilities, 'documents.items.archive'], { archived: '1' }).sections.flatMap(section => section.items).find(row => row.id === 'documents')!
    expect(archived.children?.find(row => row.id === 'archived-documents')).toMatchObject({ active: true, to: { path: '/documents', query: { archived: '1' } } })
  })
})

describe('unified application navigation', () => {
  it('keeps all meeting destinations and presets inside their application', () => {
    const item = build().find(item => item.id === 'meetings')!
    expect(item).toBeDefined()
    expect(item.sections.flatMap(section => section.items.map(row => row.to))).toEqual(['/meetings', '/meetings/follow-up', '/meetings/calendar', '/meetings/series'])
    expect(item.sections.flatMap(section => section.items).find(row => row.id === 'meetings')?.children?.map(view => view.to)).toContainEqual({ path: '/meetings', query: { state: 'done' } })
    expect(item.views).toEqual([])
    expect(item.actions.filter(action => typeof action.to === 'object' && action.to.path === '/meetings/new')).toHaveLength(1)
  })
  it('does not carry an operations filter into an unopened meetings menu', () => {
    const item = build('/operations', { state: 'done', project_id: '99' }).find(item => item.id === 'meetings')!
    expect(item.active).toBe(false)
    const children = item.sections.flatMap(section => section.items).find(row => row.id === 'meetings')?.children
    expect(children?.length).toBeGreaterThan(0)
    expect(children?.every(view => !view.active)).toBe(true)
    const create = item.actions.find(action => action.id === 'new-meeting')!
    expect(create.to).toEqual({ path: '/meetings/new', query: { returnTo: '/meetings' } })
  })
  it('keeps creation and unavailable applications out of a read-only menu', () => {
    const items = build('/meetings', {}, { capabilities: ['webvue.internal', 'meetings.read'] })
    const meetings = items.find(item => item.id === 'meetings')!
    expect(meetings.actions).toEqual([])
    expect(items.some(item => item.id === 'operations')).toBe(false)
  })
  it('marks only the selected meeting preset as active', () => {
    const item = build('/meetings', { state: 'done' }).find(item => item.id === 'meetings')!
    expect(item.sections.flatMap(section => section.items).flatMap(row => row.children ?? []).filter(view => view.active).map(view => view.to)).toEqual([{ path: '/meetings', query: { state: 'done' } }])
  })
  it('keeps the landing destination under View all without repeating its application name', () => {
    const item = build().find(item => item.id === 'meetings')!
    const links = item.sections.flatMap(section => section.items)
    expect(links.filter(link => link.label === item.label)).toEqual([])
    expect(links.find(link => link.to === '/meetings')).toMatchObject({ label: 'nav.listOf', active: true })
    expect(links.find(link => link.to === '/meetings')?.children?.[0]).toMatchObject({ label: 'nav.viewAll', to: '/meetings' })
  })
  it('does not mark View all selected while a meeting preset is active', () => {
    const item = build('/meetings', { state: 'done' }).find(item => item.id === 'meetings')!
    expect(item.sections.flatMap(section => section.items).find(link => link.to === '/meetings')?.active).toBe(false)
  })
  it('disambiguates the projects landing link while retaining overview and task destinations', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read', 'pmo.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/projects'), activeId: 'projects', contextLinks: contextLinksForModule('projects', actor, '/projects'), translate: key => key }).find(item => item.id === 'projects')!
    const links = item.sections.flatMap(section => section.items)
    expect(links.find(link => link.to === '/projects')).toMatchObject({ label: 'nav.listOf' })
    expect(links.filter(link => link.label === item.label)).toEqual([])
    expect(links.map(link => link.to)).toContain('/projects/dashboard')
    expect(links.map(link => link.to)).toContain('/tasks')
  })
  it('View all clears project filters while preserving the chosen layout', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read'] }
    const current = route('/projects', { mine: '1', status: 'at_risk', view: 'board' })
    const links = contextLinksForModule('projects', actor, '/projects').map(link => link.to === '/projects' ? { ...link, to: { path: '/projects', query: { mine: '1', status: 'at_risk', view: 'board' } } } : link)
    const item = applicationNavigation({ identity: actor, route: current, activeId: 'projects', contextLinks: links, translate: key => key }).find(item => item.id === 'projects')!
    expect(item.sections.flatMap(section => section.items).find(link => link.id === 'projects')?.to).toEqual({ path: '/projects', query: { view: 'board' } })
  })
  it('keeps the Tasks landing page reachable alongside its work destination', () => {
    const actor = { capabilities: ['webvue.internal', 'tasks.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/work'), activeId: 'tasks', contextLinks: contextLinksForModule('tasks', actor, '/work'), translate: key => key }).find(item => item.id === 'tasks')!
    const links = item.sections.flatMap(section => section.items)
    expect(links.find(link => link.to === '/my-tasks')).toMatchObject({ label: 'nav.viewAll', active: false })
    expect(links.map(link => link.to)).toContain('/work')
  })
  it('marks only Archive selected on the archived project list', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read', 'pmo.projects.manage'] }
    const item = applicationNavigation({ identity: actor, route: route('/projects', { archived: '1' }), activeId: 'projects', contextLinks: contextLinksForModule('projects', actor, '/projects').map(link => ({ ...link, active: link.to === '/projects' })), translate: key => key }).find(item => item.id === 'projects')!
    expect(item.sections.flatMap(section => section.items).flatMap(row => row.children ?? []).find(action => action.id === 'archived-projects')?.active).toBe(true)
    expect(item.sections.flatMap(section => section.items).find(link => link.to === '/projects')?.active).toBe(false)
  })
  it('preserves the Tasks cards layout on its fallback landing link', () => {
    const actor = { capabilities: ['webvue.internal', 'tasks.tasks.read'] }
    const item = applicationNavigation({ identity: actor, route: route('/my-tasks', { view: 'cards', q: 'test' }), activeId: 'tasks', contextLinks: contextLinksForModule('tasks', actor, '/my-tasks'), translate: key => key }).find(item => item.id === 'tasks')!
    expect(item.sections.flatMap(section => section.items).find(link => link.label === 'nav.viewAll')?.to).toEqual({ path: '/my-tasks', query: { view: 'cards' } })
  })
  it('puts task filters and archive under Tasks while retaining View all and global creation actions', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create'] }
    const current = route('/tasks', { view: 'board', deadline: 'today' })
    const item = applicationNavigation({ identity: actor, route: current, activeId: 'projects', contextLinks: contextLinksForModule('projects', actor, '/tasks').map(link => ({ ...link, active: link.to === '/tasks' })), translate: key => key }).find(item => item.id === 'projects')!
    const tasks = item.sections.flatMap(section => section.items).find(row => row.id === 'tasks')!
    expect(tasks.children?.find(child => child.id === 'tasks-all')).toMatchObject({ label: 'nav.viewAll', to: { path: '/tasks', query: { view: 'board' } }, active: false })
    expect(tasks.children?.find(child => child.id === 'today')).toMatchObject({ to: { path: '/tasks', query: { view: 'board', deadline: 'today' } }, active: true })
    expect(tasks.children?.some(child => child.id === 'archived-tasks')).toBe(true)
    expect(item.views).toEqual([])
    expect(item.actions.map(action => action.id)).toEqual(['new-project', 'new-task-pmo'])
    const projects = item.sections.flatMap(section => section.items).find(row => row.id === 'projects')!
    expect(projects.children?.find(child => child.id === 'mine')).toMatchObject({ to: { path: '/projects', query: { mine: '1' } }, active: false })
  })
  it('preserves the selected task preset and board layout on a trailing-slash URL', () => {
    const actor = { capabilities: ['webvue.internal', 'pmo.projects.read', 'pmo.tasks.read'] }
    const current = route('/tasks/', { view: 'board', deadline: 'today' })
    const item = applicationNavigation({ identity: actor, route: current, activeId: 'projects', contextLinks: contextLinksForModule('projects', actor, current.path).map(link => ({ ...link, active: link.id === 'tasks' })), translate: key => key }).find(item => item.id === 'projects')!
    const tasks = item.sections.flatMap(section => section.items).find(row => row.id === 'tasks')!
    expect(tasks.children?.find(child => child.id === 'today')).toMatchObject({ active: true, to: { path: '/tasks', query: { view: 'board', deadline: 'today' } } })
    expect(tasks.children?.find(child => child.id === 'tasks-all')?.to).toEqual({ path: '/tasks', query: { view: 'board' } })
  })
})
