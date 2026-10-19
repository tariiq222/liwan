import type { AppContextLink, AppManifest } from '../types'
import { financeNavActive, financeSectionOf, type FinanceSection } from './routes'
import { invoicesSearch, partnersSearch } from './search'

const CREATE: Record<FinanceSection, AppContextLink> = {
  overview: { id: 'new-sales-invoice', labelKey: 'finance.nav.newInvoice', icon: 'i-lucide-plus', to: '/finance/sales/invoices/new', capability: 'finance.invoices.manage', pinned: true },
  sales: { id: 'new-sales-invoice', labelKey: 'finance.nav.newInvoice', icon: 'i-lucide-plus', to: '/finance/sales/invoices/new', capability: 'finance.invoices.manage', pinned: true },
  purchases: { id: 'new-bill', labelKey: 'finance.nav.newBill', icon: 'i-lucide-plus', to: '/finance/purchases/bills/new', capability: 'finance.invoices.manage', pinned: true },
  payments: { id: 'new-payment', labelKey: 'finance.nav.newPayment', icon: 'i-lucide-plus', to: '/finance/payments/new', capability: 'finance.payments.manage', pinned: true },
  partners: { id: 'new-partner', labelKey: 'finance.nav.newPartner', icon: 'i-lucide-plus', to: '/finance/partners/new', capability: 'finance.partners.manage', pinned: true },
}

// The five top links stay on screen in every section; inside sales or purchases the pages of that section follow under their own heading.
const TOP: AppContextLink[] = [
  { id: 'finance-overview', labelKey: 'finance.nav.overview', icon: 'i-lucide-layout-dashboard', to: '/finance', capability: 'finance.invoices.read', exact: true },
  { id: 'finance-sales', labelKey: 'finance.nav.sales', icon: 'i-lucide-trending-up', to: '/finance/sales/invoices', capability: 'finance.invoices.read', within: '/finance/sales' },
  { id: 'finance-purchases', labelKey: 'finance.nav.purchases', icon: 'i-lucide-shopping-cart', to: '/finance/purchases/bills', capability: 'finance.invoices.read', within: '/finance/purchases' },
  { id: 'finance-payments', labelKey: 'finance.nav.payments', icon: 'i-lucide-wallet', to: '/finance/payments', capability: 'finance.payments.read', within: '/finance/payments' },
  { id: 'finance-partners', labelKey: 'finance.nav.partners', icon: 'i-lucide-contact', to: '/finance/partners', capability: 'finance.partners.read', within: '/finance/partners' },
]

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
  ],
  settings: [
    { id: 'finance-setup', labelKey: 'finance.setup.title', icon: 'i-lucide-landmark', to: '/settings/apps/finance', capability: 'finance.setup.read' },
  ],
  contextLinks: (path) => {
    const section = financeSectionOf(path)
    return [CREATE[section], ...TOP, ...(SUB_LISTS[section] ?? [])]
  },
  landing: [
    { path: '/finance', capability: 'finance.invoices.read' },
    { path: '/finance/payments', capability: 'finance.payments.read' },
    { path: '/finance/partners', capability: 'finance.partners.read' },
  ],
  routeCapabilities: [
    { pattern: /^\/finance\/partners\/(new|[^/]+\/edit)$/, capability: 'finance.partners.manage' },
    { pattern: /^\/finance\/partners(?:\/|$)/, capability: 'finance.partners.read' },
    { pattern: /^\/finance\/sales\/(invoices|credit-notes)\/(new|[^/]+\/edit)$/, capability: 'finance.invoices.manage' },
    { pattern: /^\/finance\/purchases\/(bills|refunds)\/(new|[^/]+\/edit)$/, capability: 'finance.invoices.manage' },
    { pattern: /^\/finance\/(sales|purchases)(?:\/|$)/, capability: 'finance.invoices.read' },
    { pattern: /^\/finance\/payments\/(new|[^/]+\/edit)$/, capability: 'finance.payments.manage' },
    { pattern: /^\/finance\/payments(?:\/|$)/, capability: 'finance.payments.read' },
    { pattern: /^\/finance$/, capability: 'finance.invoices.read' },
  ],
  search: [partnersSearch, invoicesSearch],
  commands: [
    { id: 'finance.new-invoice', labelKey: 'finance.nav.newInvoice', icon: 'i-lucide-trending-up', to: '/finance/sales/invoices/new', capability: 'finance.invoices.manage' },
    { id: 'finance.new-bill', labelKey: 'finance.nav.newBill', icon: 'i-lucide-shopping-cart', to: '/finance/purchases/bills/new', capability: 'finance.invoices.manage' },
    { id: 'finance.new-partner', labelKey: 'finance.nav.newPartner', icon: 'i-lucide-contact', to: '/finance/partners/new', capability: 'finance.partners.manage' },
  ],
  isNavActive: financeNavActive,
}
export default manifest
