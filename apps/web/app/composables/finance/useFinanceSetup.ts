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
type FinanceSessionUser = { id: number; company: { id: number } } | null | undefined

function financeIdentityOf(current: FinanceSessionUser): FinanceIdentity | null {
  if (!current) return null
  const userId = current.id
  const companyId = current.company.id
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(companyId) || userId <= 0 || companyId <= 0) return null
  return { userId, companyId }
}

/** The observed-identity generation of one Nuxt app (so of one server request). The first identity the app
 * knows is generation 0: no finance scope, request or cache entry exists before it, and the server render
 * (which learns it after this starts) and the hydrating client (which starts with it) must name it alike, or
 * the client cannot reuse the server's data. From there it moves on every observed identity transition, to
 * and from "unknown" included, and never goes back. It lives in a detached effect scope, never in a
 * component, so no consumer is retained by it and consumers may unmount and remount freely. The owner (the
 * finance-identity plugin) stops it when the app ends. */
export function createFinanceIdentityGeneration(me: Readonly<Ref<FinanceSessionUser>>) {
  const generation = ref(0)
  let known = financeIdentityOf(me.value) !== null
  const scope = effectScope(true)
  // Synchronous, so a transition that reverts within one tick (A, then nobody, then A) is still counted.
  scope.run(() => watch(
    () => { const identity = financeIdentityOf(me.value); return identity ? `${identity.userId}:${identity.companyId}` : null },
    (identity) => {
      if (known) generation.value += 1
      else known = identity !== null
    },
    { flush: 'sync' },
  ))
  return { generation, stop: () => scope.stop() }
}

/** The identity the signed-in session presents, or null while it is unknown (before `me` is read, or after
 * logout). The epoch is a finance-owned generation of the observed identity, not a server revision: a view
 * that returns to the same user and company after any gap in between is a new view, so a request sent for the
 * earlier one can never be taken for it. Returns the reactive scope and a reader of the scope right now,
 * which stays valid after the calling component is gone (a queued write checks it when it dispatches). */
export function useFinanceSetupScope() {
  const { me } = useMe()
  const generation = useNuxtApp().$financeIdentityGeneration as Ref<number>
  const read = (): FinanceSetupScope | null => {
    const identity = financeIdentityOf(me.value)
    return identity ? { ...identity, epoch: generation.value } : null
  }
  return { scope: computed(read), read }
}

export function useFinanceSetup(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { scope } = useFinanceSetupScope()
  const query = useQuery({
    queryKey: computed(() => financeSetupScopeKey(scope.value)),
    enabled: computed(() => toValue(enabled) && scope.value !== null),
    queryFn: () => $api('/api/v1/finance/setup', { schema: FinanceSetupSchema }),
  })
  return { ...query, scope }
}

/** Drops the in-flight reads of this identity's setup, so none can land older data over a write. */
function cancelFinanceSetupReads(queryClient: ReturnType<typeof useQueryClient>, scope: FinanceSetupScope) {
  return queryClient.cancelQueries({ queryKey: financeSetupScopeKey(scope), exact: true })
}

/** One successful setup write refreshes what the server changed: the setup itself, the fiscal years and
 * their previews, and the audit log the write added to. */
async function applyFinanceSetupWrite(queryClient: ReturnType<typeof useQueryClient>, scope: FinanceSetupScope, setup: FinanceSetup) {
  // A read that began before the write committed would otherwise resolve after this and overwrite it.
  await cancelFinanceSetupReads(queryClient, scope)
  queryClient.setQueryData(financeSetupScopeKey(scope), setup)
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['finance', 'closing'] }),
    queryClient.invalidateQueries({ queryKey: ['finance', 'audit'] }),
  ])
}

/** What a fiscal save sends: the changed fields only, and the identity the screen was read for. */
export type FinanceFiscalSaveRequest = { delta: FinanceSetupFiscalInput; scope: FinanceSetupScope }

/** A write queued while offline (or paused) can dispatch long after its screen moved on. */
export class FinanceStaleScopeError extends Error {
  constructor() { super('The finance setup screen left the identity this write was prepared for.') }
}

/** Sends only if the identity the write was prepared for is still the one on screen at this very moment;
 * otherwise it rejects without any network call, and its caller treats that as a silent drop. */
function dispatchInScope<T>(target: FinanceSetupScope, current: () => FinanceSetupScope | null, send: () => Promise<T>): Promise<T> {
  if (!sameFinanceSetupScope(target, current())) return Promise.reject(new FinanceStaleScopeError())
  return send()
}

/** Saves the fiscal year and lock changes. A response that arrives after the screen moved to another
 * identity is another screen's state: it never seeds this cache or reports success for the draft it left. */
export function useSaveFinanceFiscal() {
  const qc = useQueryClient()
  const { $api } = useApi()
  const { scope, read } = useFinanceSetupScope()
  return useMutation({
    mutationFn: (request: FinanceFiscalSaveRequest) => dispatchInScope(request.scope, read, () => $api('/api/v1/finance/setup/fiscal', {
      method: 'PATCH',
      body: request.delta,
      schema: FinanceSetupSchema,
      headers: financeExpectedContextHeaders(request.scope),
    })),
    onMutate: (request: FinanceFiscalSaveRequest) => cancelFinanceSetupReads(qc, request.scope),
    onSuccess: (setup, request) => (sameFinanceSetupScope(request.scope, scope.value)
      ? applyFinanceSetupWrite(qc, request.scope, setup)
      : undefined),
  })
}
