import { domainToASCII } from 'node:url'

/**
 * A free trial is claimed once per company, and a company is the registrable domain of its work email (free-mail
 * addresses never reach this rule, see free-mail.ts). The rule is deliberately small: there is no public-suffix library
 * in the repository and none is added. Normalisation: lowercase, IDN to punycode (`domainToASCII`), trailing dots dropped.
 * The registrable domain is the last two labels, or the last three when the last two are a listed second-level suffix.
 *
 * Limits: a second-level suffix missing from this list makes two unrelated companies under it look like one (the
 * safe direction: the vendor creates the second customer by hand), and hosts that sell subdomains (github.io and the
 * like) are treated as one company. Add a suffix here and nowhere else.
 */
export const SECOND_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  'com.sa', 'net.sa', 'org.sa', 'edu.sa', 'gov.sa', 'med.sa', 'sch.sa', 'pub.sa',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
  'com.eg', 'net.eg', 'org.eg', 'edu.eg', 'gov.eg',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.ae', 'net.ae', 'org.ae', 'ac.ae', 'gov.ae',
  'com.kw', 'com.qa', 'com.bh', 'com.om', 'com.jo', 'com.lb',
  'com.tr', 'com.br', 'com.pk', 'co.in', 'co.jp', 'co.za', 'co.nz', 'com.sg', 'com.my',
])

/** The registrable domain of an email address, or null when the address has no usable domain. */
export function companyDomain(email: string): string | null {
  const host = domainToASCII(email.slice(email.lastIndexOf('@') + 1).trim().replace(/\.+$/, ''))
  if (!host) return null
  const labels = host.split('.')
  if (labels.length < 2) return host
  const keep = labels.length >= 3 && SECOND_LEVEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2
  return labels.slice(-keep).join('.')
}
