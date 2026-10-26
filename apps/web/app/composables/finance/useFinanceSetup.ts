import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import { computed, effectScope, ref, toValue, watch } from 'vue'
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
 * reach every setup cache, while a leaf never moves between users, companies or observed generations. */
export function financeSetupScopeKey(scope: FinanceSetupScope | null) {
  return [...financeSetupKey, 'scope', scope ? financeSetupScopeToken(scope) : 'none']
}

type FinanceIdentity = { userId: number; companyId: number }

/** One counter per Nuxt app (so per server request): it moves on every observed identity transition, to and
 * from "unknown" included, and never goes back. */
const identityGenerations = new WeakMap<object, Ref<number>>()

function observedGeneration(identity: ComputedRef<FinanceIdentity | null>): Ref<number> {
  const app = useNuxtApp()
  const known = identityGenerations.get(app)
  if (known) return known
  const generation = ref(0)
  identityGenerations.set(app, generation)
  // Synchronous, so a transition that reverts within one tick (A, then nobody, then A) is still counted.
  effectScope(true).run(() => watch(
    () => (identity.value ? `${identity.value.userId}:${identity.value.companyId}` : null),
    () => { generation.value += 1 },
    { flush: 'sync' },
  ))
  return generation
}

/** The identity the signed-in session presents, or null while it is unknown (before `me` is read, or after
 * logout). The epoch is a finance-owned generation of the observed identity, not a server revision: a view
 * that returns to the same user and company after any gap in between is a new view, so a request sent for the
 * earlier one can never be taken for it. */
export function useFinanceSetupScope() {
  const { me } = useMe()
  const identity = computed<FinanceIdentity | null>(() => {
    const current = me.value
    if (!current) return null
    const userId = current.id
    const companyId = current.company.id
    if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(companyId) || userId <= 0 || companyId <= 0) return null
    return { userId, companyId }
  })
  const generation = observedGeneration(identity)
  return computed<FinanceSetupScope | null>(() => (identity.value ? { ...identity.value, epoch: generation.value } : null))
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
