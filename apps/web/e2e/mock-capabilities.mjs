// The capabilities the isolated mock grants a request. A browser that carries the cookie
// `mock_caps=reader` is a read-only user: every manage / archive / grant capability is dropped, so
// e2e specs can check what a reader does not see. `mock_caps=no_payroll` drops every `hr.payroll.*` capability (an HR
// manager without payroll access). Without the cookie the session keeps them all.
// `mock_caps=no_sales_reports` drops `sales.reports.read` (a salesperson without the reports right).
// `mock_caps=inbox_templates` and `mock_caps=inbox_flows` are the audit's limited Customer Messages roles: an agent
// keeps the conversation reads and gets exactly one area capability, never channel administration.
// `mock_caps=ops_desk` ADDS the staff reads of Operations, the Support Desk and Appointments to whichever identity the
// request already has (an opt-in grant for the audit's three staff screens, never a default change).
const WRITE = /\.(manage|archive|grant)$/
const PAYROLL = /^hr\.payroll\./
const INBOX_AGENT = /^inbox\.conversations\.(read|reply)$/
const OPS_DESK_COOKIE = /(?:^|;\s*)mock_caps=ops_desk(?:;|$)/
// What those three screens read: the request, monitoring and process lists; the ticket queue and its merge;
// the staff bookings and the types their filter offers.
const OPS_DESK_CAPABILITIES = [
  'operations.requests.read', 'operations.monitoring.read', 'operations.processes.manage',
  'helpdesk.tickets.read', 'helpdesk.requests.read', 'helpdesk.tickets.merge',
  'appointments.bookings.read',
]
// Their plan features; Operations is a base application and carries none.
const OPS_DESK_FEATURES = ['helpdesk.enabled', 'appointments.enabled']

/**
 * The opt-in staff grant: `mock_caps=ops_desk` adds the capabilities and plan features of the three staff screens.
 * Null for every other request, so the default identity, its navigation and the permission specs stay as they are.
 */
export function opsDeskForRequest(cookieHeader) {
  if (!OPS_DESK_COOKIE.test(cookieHeader ?? '')) return null
  return { capabilities: OPS_DESK_CAPABILITIES, features: OPS_DESK_FEATURES }
}

export function capabilitiesForRequest(cookieHeader, all) {
  const cookie = cookieHeader ?? ''
  const reader = /(?:^|;\s*)mock_caps=reader(?:;|$)/.test(cookie)
  const noPayroll = /(?:^|;\s*)mock_caps=no_payroll(?:;|$)/.test(cookie)
  const noSalesReports = /(?:^|;\s*)mock_caps=no_sales_reports(?:;|$)/.test(cookie)
  const inboxTemplates = /(?:^|;\s*)mock_caps=inbox_templates(?:;|$)/.test(cookie)
  const inboxFlows = /(?:^|;\s*)mock_caps=inbox_flows(?:;|$)/.test(cookie)
  const inboxAutomation = /(?:^|;\s*)mock_caps=inbox_automation(?:;|$)/.test(cookie)
  let kept = noPayroll ? all.filter(capability => !PAYROLL.test(capability)) : all
  if (noSalesReports) kept = kept.filter(capability => capability !== 'sales.reports.read')
  if (inboxTemplates) {
    kept = kept.filter(capability => !capability.startsWith('inbox.') || INBOX_AGENT.test(capability) || capability === 'inbox.templates.manage')
  }
  if (inboxFlows) {
    kept = kept.filter(capability => !capability.startsWith('inbox.') || INBOX_AGENT.test(capability) || capability === 'inbox.flows.manage')
  }
  if (inboxAutomation) {
    kept = kept.filter(capability => !capability.startsWith('inbox.') || INBOX_AGENT.test(capability) || capability === 'inbox.automation.manage')
  }
  // The staff grant is added last, so it holds whether or not the request also carries a drop.
  const opsDesk = opsDeskForRequest(cookie)
  if (opsDesk) kept = [...new Set([...kept, ...opsDesk.capabilities])]
  return reader ? kept.filter(capability => !WRITE.test(capability)) : kept
}

/** The sub-features the request says are switched off, from `mock_feature_off=<key>[,<key>]`. */
export function featuresOffForRequest(cookieHeader) {
  const match = /(?:^|;\s*)mock_feature_off=([^;]+)/.exec(cookieHeader ?? '')
  return match ? decodeURIComponent(match[1]).split(',').map(key => key.trim()).filter(Boolean) : []
}

