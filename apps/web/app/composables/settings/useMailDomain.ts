import { toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { MailDomainSchema, MailTestSendSchema, MailUsageSchema, type MailDomain, type MailDomainStart } from '@liwan/contracts'

const ROUTE = '/api/v1/mail/domain'

export const mailDomainKeys = {
  domain: ['mail', 'domain'] as const,
  usage: ['mail', 'domain', 'usage'] as const,
}

/** Messages of the settings namespace for each refusal the mail-domain routes return; any other refusal shows the generic one. */
const ERROR_KEYS: Record<string, string> = {
  forbidden: 'settings.mail.errors.forbidden',
  commercial_unavailable: 'settings.mail.errors.unavailable',
  not_found: 'settings.mail.errors.unavailable',
  domain_taken: 'settings.mail.errors.domainTaken',
  mail_domain_unverified: 'settings.mail.errors.unverified',
  invalid: 'settings.mail.errors.invalid',
  provider_error: 'settings.mail.errors.providerError',
  provider_unavailable: 'settings.mail.errors.providerUnavailable',
  mail_paused: 'settings.mail.errors.paused',
  busy: 'settings.mail.errors.busy',
}

export function mailDomainErrorKey(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && ERROR_KEYS[code]) return ERROR_KEYS[code]
  if (status === 403) return ERROR_KEYS.forbidden!
  if (status === 404) return ERROR_KEYS.not_found!
  if (status === 502) return ERROR_KEYS.provider_error!
  if (status === 503) return ERROR_KEYS.provider_unavailable!
  if (status === 409) return ERROR_KEYS.domain_taken!
  if (status === 422) return ERROR_KEYS.invalid!
  return 'errors.generic'
}

/** The card renders only when the provider is configured on the server; otherwise it is absent, not empty. */
export function mailDomainShown(domain: MailDomain | undefined): domain is MailDomain {
  return !!domain && domain.provider_configured
}

/** Whole hours until the pending return path expires, or `null` when none is pending; never negative. */
export function returnPathHoursLeft(domain: Pick<MailDomain, 'return_path_expires_at'>, now: number = Date.now()): number | null {
  if (!domain.return_path_expires_at) return null
  const ms = Date.parse(domain.return_path_expires_at) - now
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor(ms / 3_600_000))
}

export function useMailDomain(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: mailDomainKeys.domain,
    enabled: () => toValue(enabled),
    queryFn: () => $api(ROUTE, { schema: MailDomainSchema }),
    retry: false,
  })
}

/** Usage is read only while the domain is verified: the screen shows it near the ceiling and nowhere else. */
export function useMailUsage(enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: mailDomainKeys.usage,
    enabled: () => toValue(enabled),
    queryFn: () => $api(`${ROUTE}/usage`, { schema: MailUsageSchema }),
    retry: false,
  })
}

// Every transition answers with the whole domain, which replaces the cached one; an older read in flight is cancelled first.
function useStoreDomain() {
  const qc = useQueryClient()
  return async (domain: MailDomain) => {
    await qc.cancelQueries({ queryKey: mailDomainKeys.domain, exact: true })
    qc.setQueryData(mailDomainKeys.domain, domain)
    await qc.invalidateQueries({ queryKey: mailDomainKeys.usage })
    return domain
  }
}

export function useStartMailDomain() {
  const { $api } = useApi()
  const store = useStoreDomain()
  return useMutation({
    mutationFn: async (body: MailDomainStart) => store(await $api(`${ROUTE}/start`, { method: 'POST', body, schema: MailDomainSchema })),
  })
}

export function useVerifyMailDomain() {
  const { $api } = useApi()
  const store = useStoreDomain()
  return useMutation({
    mutationFn: async () => store(await $api(`${ROUTE}/verify`, { method: 'POST', schema: MailDomainSchema })),
  })
}

export function useRemoveMailDomain() {
  const { $api } = useApi()
  const store = useStoreDomain()
  return useMutation({
    mutationFn: async () => store(await $api(ROUTE, { method: 'DELETE', schema: MailDomainSchema })),
  })
}

export function useTestSendMail() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: () => $api(`${ROUTE}/test-send`, { method: 'POST', schema: MailTestSendSchema }),
  })
}
