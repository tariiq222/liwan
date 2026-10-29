import type { AppContextLink, AppIcon, AppManifest } from '../types'
import { financeNavActive, financeSectionOf, invoiceRecordPath, type FinanceSection } from './routes'
import { costCenterPicker } from './recordPicker'
import { invoicesSearch, partnersSearch } from './search'

// The reports have nothing to create, so their section opens without a create link.
const CREATE: Partial<Record<FinanceSection, AppContextLink>> = {
  overview: { id: 'new-sales-invoice', labelKey: 'finance.nav.newInvoice', icon: 'i-lucide-plus', to: '/finance/sales/invoices/new', capability: 'finance.invoices.manage', pinned: true },
  sales: { id: 'new-sales-invoice', labelKey: 'finance.nav.newInvoice', icon: 'i-lucide-plus', to: '/finance/sales/invoices/new', capability: 'finance.invoices.manage', pinned: true },
  purchases: { id: 'new-bill', labelKey: 'finance.nav.newBill', icon: 'i-lucide-plus', to: '/finance/purchases/bills/new', capability: 'finance.invoices.manage', pinned: true },
  payments: { id: 'new-payment', labelKey: 'finance.nav.newPayment', icon: 'i-lucide-plus', to: '/finance/payments/new', capability: 'finance.payments.manage', pinned: true },
  partners: { id: 'new-partner', labelKey: 'finance.nav.newPartner', icon: 'i-lucide-plus', to: '/finance/partners/new', capability: 'finance.partners.manage', pinned: true },
  accounting: { id: 'new-entry', labelKey: 'finance.nav.newEntry', icon: 'i-lucide-plus', to: '/finance/accounting/entries/new', capability: 'finance.entries.manage', pinned: true },
  budgets: { id: 'new-budget', labelKey: 'finance.nav.newBudget', icon: 'i-lucide-plus', to: '/finance/budgets/new', capability: 'finance.budgets.manage', pinned: true },
  assets: { id: 'new-asset', labelKey: 'finance.nav.newAsset', icon: 'i-lucide-plus', to: '/finance/assets/new', capability: 'finance.assets.manage', pinned: true },
  bank: { id: 'new-statement', labelKey: 'finance.nav.newStatement', icon: 'i-lucide-plus', to: '/finance/bank/statements/new', capability: 'finance.bank.manage', pinned: true },
}

// The ten top links stay on screen in every section; inside sales or purchases the pages of that section follow under their own heading.
const TOP: AppContextLink[] = [
  { id: 'finance-overview', labelKey: 'finance.nav.overview', icon: 'i-lucide-layout-dashboard', to: '/finance', capability: 'finance.invoices.read', exact: true },
  { id: 'finance-sales', labelKey: 'finance.nav.sales', icon: 'i-lucide-trending-up', to: '/finance/sales/invoices', capability: 'finance.invoices.read', within: '/finance/sales' },
  { id: 'finance-purchases', labelKey: 'finance.nav.purchases', icon: 'i-lucide-shopping-cart', to: '/finance/purchases/bills', capability: 'finance.invoices.read', within: '/finance/purchases' },
  { id: 'finance-payments', labelKey: 'finance.nav.payments', icon: 'i-lucide-wallet', to: '/finance/payments', capability: 'finance.payments.read', within: '/finance/payments' },
  { id: 'finance-partners', labelKey: 'finance.nav.partners', icon: 'i-lucide-contact', to: '/finance/partners', capability: 'finance.partners.read', within: '/finance/partners' },
  { id: 'finance-accounting', labelKey: 'finance.nav.accounting', icon: 'i-lucide-book-open', to: '/finance/accounting/entries', capability: 'finance.entries.read', within: '/finance/accounting' },
  { id: 'finance-bank', labelKey: 'finance.nav.bank', icon: 'i-lucide-building-2', to: '/finance/bank/statements', capability: 'finance.bank.read', within: '/finance/bank' },
  { id: 'finance-budgets', labelKey: 'finance.nav.budgets', icon: 'i-lucide-target', to: '/finance/budgets', capability: 'finance.budgets.read', within: '/finance/budgets' },
  { id: 'finance-assets', labelKey: 'finance.nav.assets', icon: 'i-lucide-package', to: '/finance/assets', capability: 'finance.assets.read', within: '/finance/assets' },
  { id: 'finance-reports', labelKey: 'finance.nav.reports', icon: 'i-lucide-file-chart-column', to: '/finance/reports/trial-balance', capability: 'finance.statements.read', within: '/finance/reports' },
]

const report = (id: string, slug: string, labelKey: string, icon: AppIcon, capability: string): AppContextLink =>
  ({ id: `report-${id}`, labelKey, icon, to: `/finance/reports/${slug}`, capability, section: 'finance.nav.reports' })

const SUB_LISTS: Partial<Record<FinanceSection, AppContextLink[]>> = {
  sales: [
    { id: 'sales-invoices', labelKey: 'finance.nav.invoices', icon: 'i-lucide-receipt-text', to: '/finance/sales/invoices', capability: 'finance.invoices.read', section: 'finance.nav.sales' },
    { id: 'sales-credit-notes', labelKey: 'finance.nav.creditNotes', icon: 'i-lucide-file-minus', to: '/finance/sales/credit-notes', capability: 'finance.invoices.read', section: 'finance.nav.sales' },
    { id: 'sales-customers', labelKey: 'finance.nav.customers', icon: 'i-lucide-user-round', to: '/finance/partners?kind=customer', capability: 'finance.partners.read', section: 'finance.nav.sales' },
  ],
  purchases: [
    { id: 'purchases-bills', labelKey: 'finance.nav.bills', icon: 'i-lucide-receipt-text', to: '/finance/purchases/bills', capability: 'finance.invoices.read', section: 'finance.nav.purchases' },
    { id: 'purchases-refunds', labelKey: 'finance.nav.refunds', icon: 'i-lucide-file-minus', to: '/finance/purchases/refunds', capability: 'finance.invoices.read', section: 'finance.nav.purchases' },
    { id: 'purchases-vendors', labelKey: 'finance.nav.vendors', icon: 'i-lucide-store', to: '/finance/partners?kind=vendor', capability: 'finance.partners.read', section: 'finance.nav.purchases' },
  ],
  accounting: [
    { id: 'accounting-entries', labelKey: 'finance.nav.entries', icon: 'i-lucide-notebook-pen', to: '/finance/accounting/entries', capability: 'finance.entries.read', section: 'finance.nav.accounting' },
    { id: 'accounting-accounts', labelKey: 'finance.nav.accounts', icon: 'i-lucide-list-tree', to: '/finance/accounting/accounts', capability: 'finance.accounts.read', section: 'finance.nav.accounting' },
  ],
  reports: [
    report('profit-loss', 'profit-loss', 'finance.nav.profitLoss', 'i-lucide-trending-up-down', 'finance.statements.read'),
    report('balance-sheet', 'balance-sheet', 'finance.nav.balanceSheet', 'i-lucide-columns-2', 'finance.statements.read'),
    report('trial-balance', 'trial-balance', 'finance.nav.trialBalance', 'i-lucide-scale', 'finance.statements.read'),
    report('general-ledger', 'general-ledger', 'finance.nav.generalLedger', 'i-lucide-book-text', 'finance.statements.read'),
    report('aged', 'aged-partner-balance', 'finance.nav.agedPartnerBalance', 'i-lucide-hourglass', 'finance.statements.read'),
    report('partner-statement', 'partner-statement', 'finance.nav.partnerStatement', 'i-lucide-file-user', 'finance.statements.read'),
    report('cash-flow', 'cash-flow', 'finance.nav.cashFlow', 'i-lucide-waves', 'finance.statements.read'),
    report('vat', 'vat', 'finance.nav.vat', 'i-lucide-percent', 'finance.reports.read'),
    report('vat-return', 'vat-return', 'finance.nav.vatReturn', 'i-lucide-file-check', 'finance.reports.read'),
    report('withholding', 'withholding', 'finance.nav.withholding', 'i-lucide-hand-coins', 'finance.reports.read'),
    report('analytic', 'analytic', 'finance.nav.analytic', 'i-lucide-chart-pie', 'finance.analytic.read'),
    report('budget-vs-actual', 'budget-vs-actual', 'finance.nav.budgetVsActual', 'i-lucide-target', 'finance.budgets.read'),
    report('zakat-base', 'zakat-base', 'finance.nav.zakatBase', 'i-lucide-hand-heart', 'finance.zakat.read'),
  ],
}

const manifest: AppManifest = {
  id: 'finance',
  feature: 'finance.enabled',
  routePrefixes: ['/finance'],
  rail: [{ id: 'finance', labelKey: 'nav.finance', icon: 'i-lucide-landmark', to: '/finance', order: 55 }],
  nav: [
    { to: '/finance', labelKey: 'finance.nav.overview', icon: 'i-lucide-layout-dashboard', shortcut: 'e', capability: 'finance.invoices.read' },
    { to: '/finance/sales/invoices', labelKey: 'finance.nav.sales', icon: 'i-lucide-trending-up', shortcut: '', capability: 'finance.invoices.read' },
    { to: '/finance/purchases/bills', labelKey: 'finance.nav.purchases', icon: 'i-lucide-shopping-cart', shortcut: '', capability: 'finance.invoices.read' },
    { to: '/finance/payments', labelKey: 'finance.nav.payments', icon: 'i-lucide-wallet', shortcut: '', capability: 'finance.payments.read' },
    { to: '/finance/partners', labelKey: 'finance.nav.partners', icon: 'i-lucide-contact', shortcut: '', capability: 'finance.partners.read' },
    { to: '/finance/accounting/entries', labelKey: 'finance.nav.accounting', icon: 'i-lucide-book-open', shortcut: '', capability: 'finance.entries.read' },
    { to: '/finance/bank/statements', labelKey: 'finance.nav.bank', icon: 'i-lucide-building-2', shortcut: '', capability: 'finance.bank.read' },
    { to: '/finance/budgets', labelKey: 'finance.nav.budgets', icon: 'i-lucide-target', shortcut: '', capability: 'finance.budgets.read' },
    { to: '/finance/assets', labelKey: 'finance.nav.assets', icon: 'i-lucide-package', shortcut: '', capability: 'finance.assets.read' },
    { to: '/finance/reports/trial-balance', labelKey: 'finance.nav.reports', icon: 'i-lucide-file-chart-column', shortcut: '', capability: 'finance.statements.read' },
    // The tax reports have their own capability, so a role holding only it still finds Finance.
    { to: '/finance/reports/vat', labelKey: 'finance.nav.vat', icon: 'i-lucide-percent', shortcut: '', capability: 'finance.reports.read' },
  ],
  // One page of cards; the audit card previews the log and its full list is a page of its own. The setup records (accounts, journals,
    // taxes, payment terms, asset profiles) are lists with their own filters in the URL, so each is a page of its own.
  settings: {
    id: 'finance', labelKey: 'nav.finance', icon: 'i-lucide-landmark', to: '/settings/apps/finance',
    parts: [
      { id: 'setup', labelKey: 'finance.setup.title', icon: 'i-lucide-landmark', capability: 'finance.setup.read' },
      { id: 'accounts', labelKey: 'finance.nav.accountsSettings', icon: 'i-lucide-list-tree', capability: 'finance.accounts.read', to: '/settings/apps/finance/accounts' },
      { id: 'journals', labelKey: 'finance.nav.journalsSettings', icon: 'i-lucide-notebook', capability: 'finance.journals.read', to: '/settings/apps/finance/journals' },
      { id: 'taxes', labelKey: 'finance.nav.taxesSettings', icon: 'i-lucide-percent', capability: 'finance.taxes.read', to: '/settings/apps/finance/taxes' },
      { id: 'payment-terms', labelKey: 'finance.nav.paymentTermsSettings', icon: 'i-lucide-calendar-clock', capability: 'finance.payment_terms.read', to: '/settings/apps/finance/payment-terms' },
      { id: 'asset-profiles', labelKey: 'finance.nav.assetProfilesSettings', icon: 'i-lucide-layers', capability: 'finance.assets.read', to: '/settings/apps/finance/asset-profiles' },
      { id: 'analytic', labelKey: 'finance.nav.analyticSettings', icon: 'i-lucide-chart-pie', capability: 'finance.analytic.read' },
      { id: 'closing', labelKey: 'finance.nav.closing', icon: 'i-lucide-calendar-check', capability: 'finance.closing.read' },
      { id: 'zatca', labelKey: 'finance.nav.zatca', icon: 'i-lucide-qr-code', capability: 'finance.zatca.read' },
      { id: 'audit', labelKey: 'finance.nav.audit', icon: 'i-lucide-history', capability: 'finance.audit.read', within: '/settings/apps/finance/audit' },
    ],
  },
  contextLinks: (path) => {
    const section = financeSectionOf(path)
    const create = CREATE[section]
    return [...(create ? [create] : []), ...TOP, ...(SUB_LISTS[section] ?? [])]
  },
  landing: [
    { path: '/finance', capability: 'finance.invoices.read' },
    { path: '/finance/payments', capability: 'finance.payments.read' },
    { path: '/finance/partners', capability: 'finance.partners.read' },
    { path: '/finance/accounting/entries', capability: 'finance.entries.read' },
    { path: '/finance/bank/statements', capability: 'finance.bank.read' },
    { path: '/finance/budgets', capability: 'finance.budgets.read' },
    { path: '/finance/assets', capability: 'finance.assets.read' },
    { path: '/finance/reports/trial-balance', capability: 'finance.statements.read' },
    { path: '/finance/reports/vat', capability: 'finance.reports.read' },
  ],
  routeCapabilities: [
    { pattern: /^\/finance\/partners\/(new|[^/]+\/edit)$/, capability: 'finance.partners.manage' },
    { pattern: /^\/finance\/partners(?:\/|$)/, capability: 'finance.partners.read' },
    { pattern: /^\/finance\/sales\/(invoices|credit-notes)\/(new|[^/]+\/edit)$/, capability: 'finance.invoices.manage' },
    { pattern: /^\/finance\/purchases\/(bills|refunds)\/(new|[^/]+\/edit)$/, capability: 'finance.invoices.manage' },
    { pattern: /^\/finance\/(sales|purchases)(?:\/|$)/, capability: 'finance.invoices.read' },
    { pattern: /^\/finance\/payments\/(new|[^/]+\/edit)$/, capability: 'finance.payments.manage' },
    { pattern: /^\/finance\/payments(?:\/|$)/, capability: 'finance.payments.read' },
    { pattern: /^\/finance\/accounting\/entries\/new$/, capability: 'finance.entries.manage' },
    { pattern: /^\/finance\/accounting\/entries(?:\/|$)/, capability: 'finance.entries.read' },
    { pattern: /^\/finance\/accounting\/accounts$/, capability: 'finance.accounts.read' },
    { pattern: /^\/finance\/bank\/statements\/new$/, capability: 'finance.bank.manage' },
    { pattern: /^\/finance\/bank\/statements\/[^/]+\/lines\/[^/]+$/, capability: 'finance.bank.manage' },
    { pattern: /^\/finance\/bank\/statements(?:\/|$)/, capability: 'finance.bank.read' },
    { pattern: /^\/finance\/budgets\/new$/, capability: 'finance.budgets.manage' },
    { pattern: /^\/finance\/budgets(?:\/|$)/, capability: 'finance.budgets.read' },
    { pattern: /^\/finance\/assets\/new$/, capability: 'finance.assets.manage' },
    { pattern: /^\/finance\/assets(?:\/|$)/, capability: 'finance.assets.read' },
    { pattern: /^\/finance\/reports\/analytic$/, capability: 'finance.analytic.read' },
    { pattern: /^\/finance\/reports\/budget-vs-actual$/, capability: 'finance.budgets.read' },
    { pattern: /^\/finance\/reports\/zakat-base$/, capability: 'finance.zakat.read' },
    { pattern: /^\/finance\/reports\/(vat|vat-return|withholding)$/, capability: 'finance.reports.read' },
    { pattern: /^\/finance\/reports\/(profit-loss|balance-sheet|cash-flow|trial-balance|general-ledger|aged-partner-balance|partner-statement)$/, capability: 'finance.statements.read' },
    { pattern: /^\/finance$/, capability: 'finance.invoices.read' },
  ],
  search: [partnersSearch, invoicesSearch],
  recordPickers: [costCenterPicker],
  // The kinds the actual lines of a project cost center point to, so the project page links to them by kind.
  recordLinks: [
    { kind: 'finance-invoice', capability: 'finance.invoices.read', to: id => invoiceRecordPath('out_invoice', id) },
    { kind: 'finance-credit-note', capability: 'finance.invoices.read', to: id => invoiceRecordPath('out_refund', id) },
    { kind: 'finance-bill', capability: 'finance.invoices.read', to: id => invoiceRecordPath('in_invoice', id) },
    { kind: 'finance-refund', capability: 'finance.invoices.read', to: id => invoiceRecordPath('in_refund', id) },
    { kind: 'finance-entry', capability: 'finance.entries.read', to: id => `/finance/accounting/entries/${id}` },
  ],
  commands: [
    { id: 'finance.new-invoice', labelKey: 'finance.nav.newInvoice', icon: 'i-lucide-trending-up', to: '/finance/sales/invoices/new', capability: 'finance.invoices.manage' },
    { id: 'finance.new-bill', labelKey: 'finance.nav.newBill', icon: 'i-lucide-shopping-cart', to: '/finance/purchases/bills/new', capability: 'finance.invoices.manage' },
    { id: 'finance.new-partner', labelKey: 'finance.nav.newPartner', icon: 'i-lucide-contact', to: '/finance/partners/new', capability: 'finance.partners.manage' },
    { id: 'finance.new-entry', labelKey: 'finance.nav.newEntry', icon: 'i-lucide-notebook-pen', to: '/finance/accounting/entries/new', capability: 'finance.entries.manage' },
    { id: 'finance.new-budget', labelKey: 'finance.nav.newBudget', icon: 'i-lucide-target', to: '/finance/budgets/new', capability: 'finance.budgets.manage' },
    { id: 'finance.new-asset', labelKey: 'finance.nav.newAsset', icon: 'i-lucide-package', to: '/finance/assets/new', capability: 'finance.assets.manage' },
    { id: 'finance.new-statement', labelKey: 'finance.nav.newStatement', icon: 'i-lucide-building-2', to: '/finance/bank/statements/new', capability: 'finance.bank.manage' },
  ],
  isNavActive: financeNavActive,
}
export default manifest
