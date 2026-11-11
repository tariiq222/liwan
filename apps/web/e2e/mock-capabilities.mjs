// The capabilities the isolated mock grants a request. A browser that carries the cookie
// `mock_caps=reader` is a read-only user: every manage / archive / grant capability is dropped, so
// e2e specs can check what a reader does not see. `mock_caps=no_payroll` drops every `hr.payroll.*` capability (an HR
// manager without payroll access). Without the cookie the session keeps them all.
// `mock_caps=inbox_templates` and `mock_caps=inbox_flows` are the audit's limited Customer Messages roles: an agent
// keeps the conversation reads and gets exactly one area capability, never channel administration.
const WRITE = /\.(manage|archive|grant)$/
const PAYROLL = /^hr\.payroll\./
const INBOX_AGENT = /^inbox\.conversations\.(read|reply)$/

export function capabilitiesForRequest(cookieHeader, all) {
  const cookie = cookieHeader ?? ''
  const reader = /(?:^|;\s*)mock_caps=reader(?:;|$)/.test(cookie)
  const noPayroll = /(?:^|;\s*)mock_caps=no_payroll(?:;|$)/.test(cookie)
  const inboxTemplates = /(?:^|;\s*)mock_caps=inbox_templates(?:;|$)/.test(cookie)
  const inboxFlows = /(?:^|;\s*)mock_caps=inbox_flows(?:;|$)/.test(cookie)
  let kept = noPayroll ? all.filter(capability => !PAYROLL.test(capability)) : all
  if (inboxTemplates) {
    kept = kept.filter(capability => !capability.startsWith('inbox.') || INBOX_AGENT.test(capability) || capability === 'inbox.templates.manage')
  }
  if (inboxFlows) {
    kept = kept.filter(capability => !capability.startsWith('inbox.') || INBOX_AGENT.test(capability) || capability === 'inbox.flows.manage')
  }
  return reader ? kept.filter(capability => !WRITE.test(capability)) : kept
}

/** The sub-features the request says are switched off, from `mock_feature_off=<key>[,<key>]`. */
export function featuresOffForRequest(cookieHeader) {
  const match = /(?:^|;\s*)mock_feature_off=([^;]+)/.exec(cookieHeader ?? '')
  return match ? decodeURIComponent(match[1]).split(',').map(key => key.trim()).filter(Boolean) : []
}

