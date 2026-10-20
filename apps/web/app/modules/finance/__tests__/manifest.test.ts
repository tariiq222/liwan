import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { invoicesSearch, partnersSearch } from '../search'
import { financeSectionOf, invoiceRecordPath } from '../routes'
import { appManifests, manifestForPath, settingsEntryForPath } from '../../manifests'
import { appCommands, recordLinkFor, recordPickerFor, searchProviders } from '../../surfaces'
import { canReach, canReachPath, firstAllowedPath, requiredCapabilityForPath } from '../../../utils/accessPolicy'
import { contextLinksForModule, visibleShellModules } from '../../../composables/nav/shellModules'
import { groupSections } from '../../../composables/nav/sidebarModel'
import { isContextLinkActive } from '../../../composables/useShellNavigation'
import { COST_CENTER_PAGE } from '../recordPicker'
import type { AppSearchApi } from '../../types'

const ALL = [
  'finance.invoices.read', 'finance.invoices.manage', 'finance.payments.read', 'finance.payments.manage',
  'finance.partners.read', 'finance.partners.manage', 'finance.setup.read', 'finance.setup.manage', 'finance.statements.read',
  'finance.entries.read', 'finance.entries.manage', 'finance.entries.post', 'finance.accounts.read', 'finance.bank.read', 'finance.bank.manage',
  'finance.reports.read', 'finance.budgets.read', 'finance.budgets.manage', 'finance.assets.read', 'finance.assets.manage',
  'finance.analytic.read', 'finance.closing.read', 'finance.zatca.read', 'finance.audit.read', 'finance.zakat.read',
]
const features = { readable_features: ['finance.enabled'], writable_features: ['finance.enabled'] }
const admin = { role: 'admin', capabilities: ALL, platform: features }
const ids = (path: string, identity = admin) => contextLinksForModule('finance', identity, path).map(link => link.id)

describe('finance manifest', () => {
  it('is discovered and owns /finance behind finance.enabled', () => {
    expect(appManifests.map(item => item.id)).toContain('finance')
    expect(manifestForPath('/finance/partners/3')?.id).toBe('finance')
    expect(manifest.feature).toBe('finance.enabled')
    expect(manifest.rail).toEqual([expect.objectContaining({ id: 'finance', labelKey: 'nav.finance', to: '/finance', icon: 'i-lucide-landmark' })])
  })

  it.each([
    ['/finance', 'finance.invoices.read'],
    ['/finance/sales/invoices', 'finance.invoices.read'],
    ['/finance/sales/invoices/9', 'finance.invoices.read'],
    ['/finance/sales/invoices/new', 'finance.invoices.manage'],
    ['/finance/sales/invoices/9/edit', 'finance.invoices.manage'],
    ['/finance/sales/credit-notes', 'finance.invoices.read'],
    ['/finance/purchases/bills', 'finance.invoices.read'],
    ['/finance/purchases/bills/new', 'finance.invoices.manage'],
    ['/finance/purchases/refunds/4/edit', 'finance.invoices.manage'],
    ['/finance/payments', 'finance.payments.read'],
    ['/finance/payments/7', 'finance.payments.read'],
    ['/finance/payments/new', 'finance.payments.manage'],
    ['/finance/partners', 'finance.partners.read'],
    ['/finance/partners/3', 'finance.partners.read'],
    ['/finance/partners/new', 'finance.partners.manage'],
    ['/finance/partners/3/edit', 'finance.partners.manage'],
    ['/finance/accounting/entries', 'finance.entries.read'],
    ['/finance/accounting/entries/12', 'finance.entries.read'],
    ['/finance/accounting/entries/new', 'finance.entries.manage'],
    ['/finance/accounting/accounts', 'finance.accounts.read'],
    ['/finance/bank/statements', 'finance.bank.read'],
    ['/finance/bank/statements/3', 'finance.bank.read'],
    ['/finance/bank/statements/new', 'finance.bank.manage'],
    ['/finance/bank/statements/3/lines/8', 'finance.bank.manage'],
    ['/finance/reports/trial-balance', 'finance.statements.read'],
    ['/finance/reports/general-ledger', 'finance.statements.read'],
    ['/finance/reports/aged-partner-balance', 'finance.statements.read'],
    ['/finance/reports/partner-statement', 'finance.statements.read'],
    ['/finance/reports/vat', 'finance.reports.read'],
    ['/finance/reports/withholding', 'finance.reports.read'],
    ['/finance/budgets', 'finance.budgets.read'],
    ['/finance/budgets/4', 'finance.budgets.read'],
    ['/finance/budgets/new', 'finance.budgets.manage'],
    ['/finance/assets', 'finance.assets.read'],
    ['/finance/assets/2', 'finance.assets.read'],
    ['/finance/assets/new', 'finance.assets.manage'],
    ['/finance/reports/analytic', 'finance.analytic.read'],
    ['/finance/reports/profit-loss', 'finance.statements.read'],
    ['/finance/reports/balance-sheet', 'finance.statements.read'],
    ['/finance/reports/zakat-base', 'finance.zakat.read'],
    ['/finance/reports/budget-vs-actual', 'finance.budgets.read'],
    ['/settings/apps/finance', 'finance.setup.read'],
    ['/settings/apps/finance/analytic', 'finance.analytic.read'],
    ['/settings/apps/finance/closing', 'finance.closing.read'],
    ['/settings/apps/finance/zatca', 'finance.zatca.read'],
    ['/settings/apps/finance/audit', 'finance.audit.read'],
  ])('requires %s -> %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it('lets a reader open lists and records but not the create and edit routes', () => {
    const reader = { capabilities: ALL.filter(capability => !capability.endsWith('.manage')), platform: { readable_features: ['finance.enabled'], writable_features: ['finance.enabled'] } }
    expect(canReachPath(reader, '/finance/partners')).toBe(true)
    expect(canReachPath(reader, '/finance/partners/new')).toBe(false)
    expect(canReachPath(reader, '/finance/sales/invoices/new')).toBe(false)
    expect(canReachPath(reader, '/finance/payments/2')).toBe(true)
    expect(canReachPath({ capabilities: ALL, platform: { readable_features: ['hr.enabled'], writable_features: [] } }, '/finance')).toBe(false)
  })

  it('lets each finance settings page own its subtree, the base page only the rest', () => {
    expect(settingsEntryForPath('/settings/apps/finance/closing')?.entry.id).toBe('finance-closing')
    expect(settingsEntryForPath('/settings/apps/finance/zatca')?.entry.id).toBe('finance-zatca')
    expect(settingsEntryForPath('/settings/apps/finance')?.entry.id).toBe('finance-setup')
  })

  it('gates the setup page by the registered settings entry and its feature', () => {
    expect(settingsEntryForPath('/settings/apps/finance')?.entry).toMatchObject({ id: 'finance-setup', capability: 'finance.setup.read' })
    expect(canReach(admin, 'finance.setup.read', '/settings/apps/finance')).toBe(true)
    expect(canReach({ ...admin, platform: { readable_features: ['hr.enabled'], writable_features: [] } }, 'finance.setup.read', '/settings/apps/finance')).toBe(false)
  })

  it('lands on the first page the identity may read', () => {
    expect(firstAllowedPath({ capabilities: ['finance.invoices.read'] })).toBe('/finance')
    expect(firstAllowedPath({ capabilities: ['finance.payments.read', 'finance.partners.read'] })).toBe('/finance/payments')
    expect(firstAllowedPath({ capabilities: ['finance.partners.read'] })).toBe('/finance/partners')
  })

  it('shows the rail module only to someone who may open a finance page', () => {
    expect(visibleShellModules(admin).map(module => module.id)).toContain('finance')
    expect(visibleShellModules({ capabilities: ['finance.setup.read'], platform: features }).map(module => module.id)).not.toContain('finance')
  })

  it('registers its commands with the capability of the route they open', () => {
    const commands = appCommands().filter(command => command.id.startsWith('finance.'))
    expect(commands.map(command => command.to)).toEqual(['/finance/sales/invoices/new', '/finance/purchases/bills/new', '/finance/partners/new', '/finance/accounting/entries/new', '/finance/budgets/new', '/finance/assets/new', '/finance/bank/statements/new'])
    for (const command of commands) expect(requiredCapabilityForPath(command.to), command.id).toBe(command.capability)
  })
})

describe('finance context sidebar', () => {
  const top = ['finance-overview', 'finance-sales', 'finance-purchases', 'finance-payments', 'finance-partners', 'finance-accounting', 'finance-bank', 'finance-budgets', 'finance-assets', 'finance-reports']

  it('keeps the ten top links in every section', () => {
    for (const path of ['/finance', '/finance/sales/invoices', '/finance/purchases/bills', '/finance/payments', '/finance/partners', '/finance/accounting/entries', '/finance/bank/statements/2', '/finance/budgets/3', '/finance/assets', '/finance/reports/vat']) {
      expect(ids(path).filter(id => top.includes(id)), path).toEqual(top)
    }
  })

  it.each([
    ['/finance', 'new-sales-invoice', '/finance/sales/invoices/new', 'finance.invoices.manage'],
    ['/finance/sales/credit-notes', 'new-sales-invoice', '/finance/sales/invoices/new', 'finance.invoices.manage'],
    ['/finance/purchases/refunds', 'new-bill', '/finance/purchases/bills/new', 'finance.invoices.manage'],
    ['/finance/payments/3', 'new-payment', '/finance/payments/new', 'finance.payments.manage'],
    ['/finance/partners', 'new-partner', '/finance/partners/new', 'finance.partners.manage'],
    ['/finance/accounting/accounts', 'new-entry', '/finance/accounting/entries/new', 'finance.entries.manage'],
    ['/finance/bank/statements', 'new-statement', '/finance/bank/statements/new', 'finance.bank.manage'],
    ['/finance/budgets/3', 'new-budget', '/finance/budgets/new', 'finance.budgets.manage'],
    ['/finance/assets', 'new-asset', '/finance/assets/new', 'finance.assets.manage'],
  ])('pins the create link of %s', (path, id, to, capability) => {
    const links = contextLinksForModule('finance', admin, path)
    expect(links[0]).toMatchObject({ id, to, capability, pinned: true })
    expect(links.filter(link => link.pinned)).toHaveLength(1)
  })

  it('lists the pages of the open section under its own heading', () => {
    expect(ids('/finance/sales/invoices/5')).toEqual(expect.arrayContaining(['sales-invoices', 'sales-credit-notes', 'sales-customers']))
    expect(ids('/finance/sales/invoices/5')).not.toContain('purchases-bills')
    expect(ids('/finance/purchases/bills')).toEqual(expect.arrayContaining(['purchases-bills', 'purchases-refunds', 'purchases-vendors']))
    expect(ids('/finance/partners')).not.toContain('sales-invoices')
    const sales = contextLinksForModule('finance', admin, '/finance/sales/invoices')
    expect(sales.filter(link => link.section).map(link => link.to)).toEqual(['/finance/sales/invoices', '/finance/sales/credit-notes', '/finance/partners?kind=customer'])
    const sections = groupSections(sales.filter(link => !link.pinned))
    expect(sections.map(section => section.titleKey)).toEqual([null, 'finance.nav.sales'])
  })

  it('opens the reports without a create link and lists every report', () => {
    const links = contextLinksForModule('finance', admin, '/finance/reports/vat')
    expect(links.filter(link => link.pinned)).toHaveLength(0)
    expect(links.filter(link => link.section === 'finance.nav.reports').map(link => link.to)).toEqual([
      '/finance/reports/profit-loss', '/finance/reports/balance-sheet', '/finance/reports/trial-balance', '/finance/reports/general-ledger', '/finance/reports/aged-partner-balance',
      '/finance/reports/partner-statement', '/finance/reports/vat', '/finance/reports/withholding', '/finance/reports/analytic',
      '/finance/reports/budget-vs-actual', '/finance/reports/zakat-base',
    ])
    for (const link of links.filter(item => item.section === 'finance.nav.reports')) expect(requiredCapabilityForPath(String(link.to))).toBe(link.capability)
    expect(ids('/finance/accounting/entries')).toEqual(expect.arrayContaining(['accounting-entries', 'accounting-accounts']))
  })

  it('hides a link whose capability the identity lacks', () => {
    const partnersOnly = { role: 'employee', capabilities: ['finance.partners.read'], platform: features }
    expect(ids('/finance/sales/invoices', partnersOnly)).toEqual(['finance-partners', 'sales-customers'])
  })

  it('lights the top link across its whole section and the leaf link only on its own pages', () => {
    const active = (path: string, id: string) => {
      const link = contextLinksForModule('finance', admin, path).find(item => item.id === id)!
      return isContextLinkActive(path, link)
    }
    expect(active('/finance', 'finance-overview')).toBe(true)
    expect(active('/finance/partners', 'finance-overview')).toBe(false)
    expect(active('/finance/sales/credit-notes/4', 'finance-sales')).toBe(true)
    expect(active('/finance/sales/invoices/new', 'finance-sales')).toBe(true)
    expect(active('/finance/sales/credit-notes/4', 'sales-credit-notes')).toBe(true)
    expect(active('/finance/sales/credit-notes/4', 'sales-invoices')).toBe(false)
    expect(active('/finance/sales/invoices/new', 'sales-invoices')).toBe(false)
    expect(active('/finance/partners/3', 'finance-partners')).toBe(true)
    expect(active('/finance/sales/invoices', 'sales-customers')).toBe(false)
  })

  it('maps a path to its section', () => {
    expect(financeSectionOf(undefined)).toBe('overview')
    expect(financeSectionOf('/finance')).toBe('overview')
    expect(financeSectionOf('/finance/partners?kind=vendor')).toBe('partners')
    expect(financeSectionOf('/finance/salesx')).toBe('overview')
  })

  it('opens the record of each document family under its own folder', () => {
    expect(invoiceRecordPath('out_invoice', 3)).toBe('/finance/sales/invoices/3')
    expect(invoiceRecordPath('out_refund', 3)).toBe('/finance/sales/credit-notes/3')
    expect(invoiceRecordPath('in_receipt', 3)).toBe('/finance/purchases/bills/3')
    expect(invoiceRecordPath('in_refund', 3)).toBe('/finance/purchases/refunds/3')
  })
})

describe('finance search providers', () => {
  const calls: Array<[string, unknown]> = []
  const api = (async (url: string, options: { query?: unknown }) => {
    calls.push([url, options.query])
    return url.endsWith('/partners')
      ? { items: [{ id: 3, name: 'النخبة', vat: '300', company_registry: '', street: '', city: '', state: null, country: null, is_company: true, customer: true, vendor: false, active: true }], total: 7 }
      : { items: [{ id: 5, name: null, move_type: 'in_refund', state: 'draft', payment_state: 'not_paid', partner: { id: 2, name: 'الأفق' }, journal: { id: 1, name: 'J' }, invoice_date: null, invoice_date_due: null, currency: 'SAR', amount_untaxed: 1, amount_tax: 0, amount_total: 1, amount_residual: 1 }], total: 1 }
  }) as unknown as AppSearchApi

  it('is listed after the PMO providers, in rail order', () => {
    expect(searchProviders().map(provider => provider.id)).toEqual(['pmo-projects', 'pmo-tasks', 'finance-partners', 'finance-invoices'])
  })

  it('searches partners on the server and links each row to its record', async () => {
    const page = await partnersSearch.search(api, 'نخ', 20)
    expect(calls.at(-1)).toEqual(['/api/v1/finance/partners', { q: 'نخ', limit: 20, offset: 20 }])
    expect(page).toEqual({ rows: [{ id: 3, label: 'النخبة', to: '/finance/partners/3', caption: '300' }], total: 7 })
    expect(partnersSearch.queryKey('x')).toEqual(['search', 'finance-partners', 'x'])
  })

  it('searches invoices on the server and links a draft by its partner, to the folder of its document type', async () => {
    const page = await invoicesSearch.search(api, '5', 0)
    expect(calls.at(-1)).toEqual(['/api/v1/finance/invoices', { q: '5', limit: 20, offset: 0 }])
    expect(page.rows).toEqual([{ id: 5, label: 'الأفق', to: '/finance/purchases/refunds/5', caption: undefined }])
  })
})

describe('finance record surfaces for other applications', () => {
  it.each([
    ['finance-invoice', 7, '/finance/sales/invoices/7', 'finance.invoices.read'],
    ['finance-credit-note', 7, '/finance/sales/credit-notes/7', 'finance.invoices.read'],
    ['finance-bill', 7, '/finance/purchases/bills/7', 'finance.invoices.read'],
    ['finance-refund', 7, '/finance/purchases/refunds/7', 'finance.invoices.read'],
    ['finance-entry', 7, '/finance/accounting/entries/7', 'finance.entries.read'],
  ])('links %s to its record page behind its capability', (kind, id, to, capability) => {
    expect(recordLinkFor(kind)?.to(id)).toBe(to)
    expect(recordLinkFor(kind)?.capability).toBe(capability)
  })

  it('declares the cost center picker behind the analytic read capability and walks every page', async () => {
    const picker = recordPickerFor('cost-center')
    expect(picker).toMatchObject({ kind: 'cost-center', capability: 'finance.analytic.read' })
    const account = (id: number, code: string) => ({ id, name: `CC${id}`, code, plan: { id: 1, name: 'P' }, active: true })
    const api = vi.fn(async (_url: string, options: { query?: { offset?: number } }) => options.query?.offset === 0
      ? { items: Array.from({ length: COST_CENTER_PAGE }, (_, i) => account(i + 1, i === 0 ? 'A1' : '')), total: COST_CENTER_PAGE + 1 }
      : { items: [account(COST_CENTER_PAGE + 1, '')], total: COST_CENTER_PAGE + 1 }) as unknown as AppSearchApi
    const options = await picker!.options(api)
    expect(api).toHaveBeenCalledTimes(2)
    expect(api).toHaveBeenNthCalledWith(1, '/api/v1/finance/analytic-accounts', expect.objectContaining({ query: { limit: COST_CENTER_PAGE, offset: 0 } }))
    expect(options).toHaveLength(COST_CENTER_PAGE + 1)
    expect(options[0]).toEqual({ id: 1, name: 'A1 · CC1' })
    expect(options[1]).toEqual({ id: 2, name: 'CC2' })
  })
})
