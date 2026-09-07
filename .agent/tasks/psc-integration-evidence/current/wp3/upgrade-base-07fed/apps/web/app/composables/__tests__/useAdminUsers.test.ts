import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import {
  ACCESS_MUTATION_GC_TIME,
  adminUserKeys,
  beginAccessRefreshInFlight,
  drainAccessRefreshInFlight,
  invalidateAdminUserCaches,
  nextAdminUserSecuritySuccess,
  refreshMeInNuxtContext,
  type AccessRefreshInFlightState,
  type AdminUserDetail,
  type NuxtContextRunner,
} from '../useAdminUsers'

const source = readFileSync(join(import.meta.dirname, '../useAdminUsers.ts'), 'utf8')
const formSource = readFileSync(join(import.meta.dirname, '../../components/access/users/UserSecurityForm.vue'), 'utf8')
const pageSource = readFileSync(join(import.meta.dirname, '../../pages/settings/users/[userId]/security.vue'), 'utf8')

function fakeUser(id = 7): AdminUserDetail {
  return { id } as AdminUserDetail
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

describe('useAdminUsers cache invalidation', () => {
  it('refreshes the Nuxt `me` key through composable context, not a vue-query key', async () => {
    const queryClient = new QueryClient()
    const refreshMe = vi.fn()
    const waitForAccessRefresh = vi.fn(async () => {})
    const nuxt: NuxtContextRunner = {
      runWithContext: <R>(fn: () => R) => fn(),
    }
    const runWithContext = vi.spyOn(nuxt, 'runWithContext')
    await queryClient.prefetchQuery({ queryKey: ['me'], queryFn: async () => ({ id: 1 }) })
    await queryClient.prefetchQuery({ queryKey: adminUserKeys.all, queryFn: async () => ({ items: [], total: 0 }) })
    await queryClient.prefetchQuery({ queryKey: ['people'], queryFn: async () => [] })
    await queryClient.prefetchQuery({ queryKey: ['hr', 'employees'], queryFn: async () => ({ items: [], total: 0 }) })
    await queryClient.prefetchQuery({ queryKey: ['access', 'audit'], queryFn: async () => ({ items: [], total: 0 }) })

    await invalidateAdminUserCaches(queryClient, fakeUser(), { nuxt, refreshMe, waitForAccessRefresh })

    expect(runWithContext).toHaveBeenCalledTimes(1)
    expect(refreshMe).toHaveBeenCalledTimes(1)
    expect(waitForAccessRefresh).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(['me'])?.isInvalidated).toBeFalsy()
    expect(queryClient.getQueryState(adminUserKeys.all)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['people'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['hr', 'employees'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['access', 'audit'])?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  it('noops the me refresh when no Nuxt context is available', () => {
    const refreshMe = vi.fn()
    expect(refreshMeInNuxtContext(null, refreshMe)).toBeUndefined()
    expect(refreshMe).not.toHaveBeenCalled()
  })

  it('does not invent a vue-query `me` invalidation', () => {
    expect(source).toContain("refreshNuxtData('me')")
    expect(source).toContain('refreshMeInNuxtContext')
    expect(source).not.toContain('void refreshMeInNuxtContext')
    expect(source).not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\[['"]me['"]\]/)
  })
})

describe('admin user success waits for me refresh then access reset', () => {
  it('does not resolve while me refresh is still pending', async () => {
    const queryClient = new QueryClient()
    const refresh = deferred()
    const refreshMe = vi.fn(() => refresh.promise)
    const waitForAccessRefresh = vi.fn(async () => {})
    const nuxt: NuxtContextRunner = { runWithContext: <R>(fn: () => R) => fn() }

    let settled = false
    const done = invalidateAdminUserCaches(queryClient, fakeUser(), { nuxt, refreshMe, waitForAccessRefresh }).then(() => { settled = true })
    await Promise.resolve()
    expect(refreshMe).toHaveBeenCalledTimes(1)
    expect(waitForAccessRefresh).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    refresh.resolve()
    await done
    expect(waitForAccessRefresh).toHaveBeenCalledTimes(1)
    expect(settled).toBe(true)
    queryClient.clear()
  })

  it('resolves me first, then waits for plugin reset before onSuccess settles', async () => {
    const queryClient = new QueryClient()
    const refresh = deferred()
    const reset = deferred()
    const refreshMe = vi.fn(() => refresh.promise)
    const waitForAccessRefresh = vi.fn(() => reset.promise)
    const nuxt: NuxtContextRunner = { runWithContext: <R>(fn: () => R) => fn() }
    const observer = new MutationObserver(queryClient, {
      mutationFn: async () => fakeUser(),
      onSuccess: (user) => invalidateAdminUserCaches(queryClient, user, { nuxt, refreshMe, waitForAccessRefresh }),
    })

    let settled = false
    const mutate = observer.mutate().then(() => { settled = true })
    await vi.waitFor(() => expect(refreshMe).toHaveBeenCalledTimes(1))
    expect(waitForAccessRefresh).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    refresh.resolve()
    await vi.waitFor(() => expect(waitForAccessRefresh).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)

    reset.resolve()
    await mutate
    expect(settled).toBe(true)
    queryClient.clear()
  })
})

describe('access refresh in-flight drain', () => {
  it('keeps a newer reset when the first promise settles', async () => {
    const state: AccessRefreshInFlightState = { inFlight: null }
    const first = deferred()
    const second = deferred()
    beginAccessRefreshInFlight(state, () => first.promise)
    const firstPromise = state.inFlight
    beginAccessRefreshInFlight(state, () => second.promise)
    first.resolve()
    await firstPromise
    expect(state.inFlight).toBe(second.promise)
    second.resolve()
    await state.inFlight
    expect(state.inFlight).toBeNull()
  })

  it('drains a second refresh that starts while the first is pending', async () => {
    const state: AccessRefreshInFlightState = { inFlight: null }
    const first = deferred()
    const second = deferred()
    beginAccessRefreshInFlight(state, () => first.promise)
    const drained = drainAccessRefreshInFlight(() => state.inFlight)
    let drainedDone = false
    void drained.then(() => { drainedDone = true })
    beginAccessRefreshInFlight(state, () => second.promise)
    first.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(drainedDone).toBe(false)
    second.resolve()
    await drained
    expect(drainedDone).toBe(true)
    expect(state.inFlight).toBeNull()
  })
})

describe('useAdminUsers sensitive mutation cleanup', () => {
  it('evicts mutation variables after success and failure', async () => {
    async function run(mutationFn: (body: { password: string }) => Promise<unknown>) {
      const queryClient = new QueryClient()
      let reset = () => {}
      const observer = new MutationObserver(queryClient, {
        gcTime: ACCESS_MUTATION_GC_TIME,
        mutationFn,
        onSettled: () => reset(),
      })
      reset = observer.reset
      const unsubscribe = observer.subscribe(() => {})
      await observer.mutate({ password: 'secret-password' }).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
      unsubscribe()
      queryClient.clear()
    }

    await run(async () => ({ ok: true }))
    await run(async () => {
      throw new Error('request failed')
    })
  })

  it('keeps mutation gcTime at zero and resets on settle', () => {
    expect(ACCESS_MUTATION_GC_TIME).toBe(0)
    expect(source).toContain('gcTime: ACCESS_MUTATION_GC_TIME')
    expect(source).toContain('onSettled: () => resetRef.value()')
  })
})

describe('admin user security success is page-scoped and controlled', () => {
  it('keeps success on the security route parent, not a module Map, stale detail, or child remount state', () => {
    expect(source).not.toContain('adminUserSecuritySuccessById')
    expect(source).not.toContain('rememberAdminUserSecuritySuccess')
    expect(source).not.toContain('displayedUser')
    expect(source).toContain("refreshNuxtData('me')")
    expect(formSource).toContain('onSuccessKey')
    expect(formSource).toContain('clearSecrets')
    expect(formSource).toContain('targetId')
    expect(formSource).toContain('useIsMutating')
    expect(formSource).toContain('adminUserMutationKey')
    expect(formSource).not.toContain('role="status"')
    expect(formSource).not.toMatch(/watch\(\s*\(\)\s*=>\s*props\.user\s*,/)
    expect(formSource).not.toContain('useState(')
    expect(pageSource).toContain('successKey')
    expect(pageSource).toContain('nextAdminUserSecuritySuccess')
    expect(pageSource).toContain('on-success-key')
    expect(pageSource).not.toContain('displayedUser')
    expect(pageSource).toContain(':loading="user.isLoading.value"')
    expect(pageSource).toContain(':error="user.error.value"')
    expect(pageSource).toContain(':empty="!user.data.value"')
    expect(pageSource).toContain('v-if="user.data.value"')
    expect(pageSource).toMatch(/watch\(\[id, blocked\]/)
    expect(pageSource).toContain('onBeforeUnmount')
    expect(pageSource).toContain('role="status"')
    expect(pageSource).not.toMatch(/Dialog|Sheet|Drawer/)
    expect(pageSource).not.toContain('useState(')
  })

  it('ignores late callbacks for another user and when the page is blocked', () => {
    expect(nextAdminUserSecuritySuccess(12, 12, 'access.users.accessReactivated')).toBe('access.users.accessReactivated')
    expect(nextAdminUserSecuritySuccess(12, 12, '')).toBe('')
    expect(nextAdminUserSecuritySuccess(13, 12, 'access.users.accessReactivated')).toBeUndefined()
    expect(nextAdminUserSecuritySuccess(12, 12, 'access.users.accessReactivated', true)).toBeUndefined()
  })
})
