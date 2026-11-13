import { domainToASCII } from 'node:url'

/**
 * A free trial is claimed once per company, and a company is the registrable domain of its work email: the public
 * suffix plus one label. There is no public-suffix library in the repository and none is added, so the suffix comes
 * from a small general rule (schema_054.sql carries the same rule in SQL for its backfill; change both together).
 *
 * Normalisation: lowercase, IDN to punycode (`domainToASCII`), trailing dots dropped.
 * Public suffix: when the last label is a two-letter ASCII country code and the label before it is one of
 * GENERIC_SECOND_LEVEL_LABELS, the suffix is those two labels (`com.sa`, `co.uk`, `com.ng`, `or.jp`); otherwise it is
 * the last label. The registrable domain is the suffix plus one label.
 * An address that sits directly on a suffix (`a@com.sa`, `a@sa`) or under a SHARED_HOSTING_SUFFIXES entry cannot identify
 * a company, so `companyDomain` returns null and sign-up refuses it as a non-business email.
 *
 * Limits: a country that registers company names under a second-level label outside the set (for example `ac.ke` is in,
 * `co.in` is in, but `nic.in` or `gv.at` are not) leaves its companies sharing one claim, and a company whose real name is
 * itself one of the generic labels under a country code (`go.it`, `me.uk`) is refused at start; the vendor creates either
 * customer by hand. Three-level public suffixes (`k12.ca.us`) and private suffixes beyond the hosting list are not modelled.
 */
export const GENERIC_SECOND_LEVEL_LABELS: ReadonlySet<string> = new Set([
  'com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'mil', 'sch', 'med', 'pub', 'ltd', 'plc', 'me', 'info', 'biz', 'name', 'nom',
  'or', 'ne', 'go', 'gob', 'gouv', 'k12',
])

/** Providers that hand every customer a subdomain: mail on them cannot identify a company, and none may claim the provider. */
export const SHARED_HOSTING_SUFFIXES: readonly string[] = [
  'github.io', 'gitlab.io', 'web.app', 'firebaseapp.com', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
  'herokuapp.com', 'blogspot.com', 'wordpress.com',
]

/** The registrable domain of an email address, or null when the address cannot identify a company. */
export function companyDomain(email: string): string | null {
  const host = domainToASCII(email.slice(email.lastIndexOf('@') + 1).trim().replace(/\.+$/, ''))
  if (!host || SHARED_HOSTING_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return null
  const labels = host.split('.')
  const tld = labels[labels.length - 1]!
  const suffixLength = labels.length >= 2 && /^[a-z]{2}$/.test(tld) && GENERIC_SECOND_LEVEL_LABELS.has(labels[labels.length - 2]!) ? 2 : 1
  return labels.length > suffixLength ? labels.slice(-(suffixLength + 1)).join('.') : null
}
