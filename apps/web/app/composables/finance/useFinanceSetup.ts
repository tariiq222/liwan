import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { FinanceSetupSchema, type FinanceSetup, type FinanceSetupFiscalInput } from '@webvue/contracts'
import {
  financeExpectedContextHeaders,
  financeSetupScopeToken,
  sameFinanceSetupScope,
  type FinanceSetupScope,
} from './financeFiscalSetup'

export type { FinanceSetup }

export const financeSetupKey = ['finance', 'setup'] as const

/** The cache leaf of one identity. The prefix stays, so the existing closing and audit invalidations still
 * reach every setup cache, while a leaf never moves between users, companies or observed epochs. */
export function financeSetupScopeKey(scope: FinanceSetupScope | null) {
  return [...financeSetupKey, 'scope', scope ? financeSetupScopeToken(scope) : 'none']
}

/** The identity the signed-in session presents, or null while it is unknown (before `me` is read, or after
 * logout). The epoch is the observed access-policy revision: a marker of the screen this draft belongs to,
 * not a session generation, so it never claims to detect a re-issued session for the same user and company. */
export function useFinanceSetupScope() {
  const { me } = useMe()
  return computed<FinanceSetupScope | null>(() => {
    const identity = me.value
    if (!identity) return null
    const userId = identity.id
    const companyId = identity.company.id
    if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(companyId) || userId <= 0 || companyId <= 0) return null
    return { userId, companyId, epoch: identity.access_policy_version ?? 0 }
  })
}

export function useFinanceSetup(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const scope = useFinanceSetupScope()
  const query = useQuery({
    queryKey: computed(() => financeSetupScopeKey(scope.value)),
    enabled: computed(() => toValue(enabled) && scope.value !== null),
    queryFn: () => $api('/api/v1/finance/setup', { schema: FinanceSetupSchema }),
  })
  return { ...query, scope }
}

/** One successful setup write refreshes what the server changed: the setup itself, the fiscal years and
 * their previews, and the audit log the write added to. */
function applyFinanceSetupWrite(queryClient: ReturnType<typeof useQueryClient>, scope: FinanceSetupScope, setup: FinanceSetup) {
  queryClient.setQueryData(financeSetupScopeKey(scope), setup)
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['finance', 'closing'] }),
    queryClient.invalidateQueries({ queryKey: ['finance', 'audit'] }),
  ])
}

/** What a fiscal save sends: the changed fields only, and the identity the screen was read for. */
export type FinanceFiscalSaveRequest = { delta: FinanceSetupFiscalInput; scope: FinanceSetupScope }

/** Saves the fiscal year and lock changes. A response that arrives after the screen moved to another
 * identity is another screen's state: it never seeds this cache or reports success for the draft it left. */
export function useSaveFinanceFiscal() {
  const qc = useQueryClient()
  const { $api } = useApi()
  const scope = useFinanceSetupScope()
  return useMutation({
    mutationFn: (request: FinanceFiscalSaveRequest) => $api('/api/v1/finance/setup/fiscal', {
      method: 'PATCH',
      body: request.delta,
      schema: FinanceSetupSchema,
      headers: financeExpectedContextHeaders(request.scope),
    }),
    onSuccess: (setup, request) => (sameFinanceSetupScope(request.scope, scope.value)
      ? applyFinanceSetupWrite(qc, request.scope, setup)
      : undefined),
  })
}

/** Loads the Saudi chart of accounts into the company. Like the fiscal save, it states the identity its
 * screen was read for and drops a response that belongs to an identity the screen has left. */
export function useLoadFinanceChart() {
  const qc = useQueryClient()
  const { $api } = useApi()
  const scope = useFinanceSetupScope()
  return useMutation({
    mutationFn: (target: FinanceSetupScope) => $api('/api/v1/finance/setup/chart', {
      method: 'POST',
      schema: FinanceSetupSchema,
      headers: financeExpectedContextHeaders(target),
    }),
    onSuccess: (setup, target) => (sameFinanceSetupScope(target, scope.value)
      ? applyFinanceSetupWrite(qc, target, setup)
      : undefined),
  })
}
