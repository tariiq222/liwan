import { hasInjectionContext, inject, shallowReadonly, shallowRef, type InjectionKey, type ShallowRef } from 'vue'
import type { QueryClient } from '@tanstack/vue-query'

export type SessionQueryOwner = Readonly<{
  generation: number
  identity: string
  publicView: boolean
  client: QueryClient
}>
type SessionQueryActor = Readonly<{ identity: string; generation: number }>
export type SessionQueryScope = {
  current: Readonly<ShallowRef<SessionQueryOwner>>
  actor: Readonly<ShallowRef<SessionQueryActor>>
  prepare: (identity: string, publicView: boolean) => void
  bind: () => void
}
export const sessionQueryScopeKey: InjectionKey<SessionQueryScope> = Symbol('session-query-scope')
export const sessionQueryOwnerKey: InjectionKey<SessionQueryOwner> = Symbol('session-query-owner')

/** One cache per mounted owner lifetime; returning to an earlier identity never reuses its client. */
export function createSessionQueryScope(
  createClient: (generation: number) => QueryClient,
  identity: string,
  publicView: boolean,
): SessionQueryScope {
  let bound = false
  const actor = shallowRef<SessionQueryActor>({ identity, generation: 0 })
  const current = shallowRef<SessionQueryOwner>({ generation: 0, identity, publicView, client: createClient(0) })
  return {
    current: shallowReadonly(current),
    actor: shallowReadonly(actor),
    bind: () => { bound = true },
    prepare(nextIdentity, nextPublicView) {
      if (actor.value.identity !== nextIdentity) actor.value = { identity: nextIdentity, generation: actor.value.generation + 1 }
      const previous = current.value
      // Initial route/identity resolution precedes the first provider. Keep its
      // SSR-restored client while recording the resolved initial owner.
      if (!bound) {
        current.value = { ...previous, identity: nextIdentity, publicView: nextPublicView }
        return
      }
      if (previous.publicView && nextPublicView) return
      if (!previous.publicView && !nextPublicView && previous.identity === nextIdentity) return
      previous.client.clear()
      const generation = previous.generation + 1
      current.value = { generation, identity: nextIdentity, publicView: nextPublicView, client: createClient(generation) }
    },
  }
}

export function useSessionQueryScope(): SessionQueryScope {
  const scope = inject(sessionQueryScopeKey)
  if (!scope) throw new Error('Session query scope is not installed')
  return scope
}

/** Components retain their owner; root services capture the active owner per request. */
export function captureSessionQueryOwner(): (publicRequest?: boolean) => (() => boolean) {
  if (!hasInjectionContext()) return () => () => true
  const scope = inject(sessionQueryScopeKey, undefined)
  const componentOwner = inject(sessionQueryOwnerKey, undefined)
  return (publicRequest = false) => {
    const owner = componentOwner ?? scope?.current.value
    const actor = scope?.actor.value
    return () => !scope || !owner || (scope.current.value.generation === owner.generation && (publicRequest || scope.actor.value === actor))
  }
}
