// The capabilities the isolated mock grants a request. A browser that carries the cookie
// `mock_caps=reader` is a read-only user: every manage / archive / grant capability is dropped, so
// e2e specs can check what a reader does not see. Without the cookie the session keeps them all.
const WRITE = /\.(manage|archive|grant)$/

export function capabilitiesForRequest(cookieHeader, all) {
  const reader = /(?:^|;\s*)mock_caps=reader(?:;|$)/.test(cookieHeader ?? '')
  return reader ? all.filter(capability => !WRITE.test(capability)) : all
}
