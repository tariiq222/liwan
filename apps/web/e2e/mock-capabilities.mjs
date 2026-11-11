// The capabilities the isolated mock grants a request. A browser that carries the cookie
// `mock_caps=reader` is a read-only user: every manage / archive / grant capability is dropped, so
// e2e specs can check what a reader does not see. `mock_caps=no_payroll` drops every `hr.payroll.*` capability (an HR
// manager without payroll access). Without the cookie the session keeps them all.
const WRITE = /\.(manage|archive|grant)$/
const PAYROLL = /^hr\.payroll\./

export function capabilitiesForRequest(cookieHeader, all) {
  const reader = /(?:^|;\s*)mock_caps=reader(?:;|$)/.test(cookieHeader ?? '')
  const noPayroll = /(?:^|;\s*)mock_caps=no_payroll(?:;|$)/.test(cookieHeader ?? '')
  const kept = noPayroll ? all.filter(capability => !PAYROLL.test(capability)) : all
  return reader ? kept.filter(capability => !WRITE.test(capability)) : kept
}
