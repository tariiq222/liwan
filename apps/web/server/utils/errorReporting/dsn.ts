/** The parts of a Sentry DSN (`https://<public key>@<host>[/<path>]/<project id>`) that the tunnel needs. */
export type ParsedDsn = { publicKey: string; projectId: string; envelopeUrl: string }

/** Throws on a DSN that is not one, so a mistyped `NUXT_SENTRY_DSN` stops the server at start instead of failing silently. */
export function parseDsn(dsn: string): ParsedDsn {
  const url = new URL(dsn)
  const segments = url.pathname.split('/').filter(Boolean)
  const projectId = segments.pop()
  if (!['http:', 'https:'].includes(url.protocol) || !url.username || !projectId || !/^\d+$/.test(projectId)) {
    throw new Error('invalid_sentry_dsn')
  }
  const prefix = segments.length > 0 ? `/${segments.join('/')}` : ''
  return { publicKey: url.username, projectId, envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/` }
}
