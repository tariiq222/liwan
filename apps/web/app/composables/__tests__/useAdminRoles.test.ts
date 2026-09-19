import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import {
  adminRoleKeys,
  invalidateAdminRoleCaches,
  type RoleDetail,
} from '../useAdminRoles'
import type { NuxtContextRunner } from '../useAdminUsers'

const source = readFileSync(join(import.meta.dirname, '../useAdminRoles.ts'), 'utf8')

function fakeRole(id = 11): RoleDetail {
  return { id } as RoleDetail
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

describe('useAdminRoles cache invalidation', () => {
  it('refreshes Nuxt `me` through captured context on successful role updates', async () => {
    const queryClient = new QueryClient()
    const refreshMe = vi.fn()
    const waitForAccessRefresh = vi.fn(async () => {})
    const nuxt: NuxtContextRunner = {
      runWithContext: <R>(fn: () => R) => fn(),
    }
    const runWithContext = vi.spyOn(nuxt, 'runWithContext')
    await queryClient.prefetchQuery({ queryKey: ['me'], queryFn: async () => ({ id: 1 }) })
    await queryClient.prefetchQuery({ queryKey: adminRoleKeys.all, queryFn: async () => ({ items: [], total: 0 }) })
    await queryClient.prefetchQuery({ queryKey: ['access', 'users'], queryFn: async () => ({ items: [], total: 0 }) })
    await queryClient.prefetchQuery({ queryKey: ['access', 'audit'], queryFn: async () => ({ items: [], total: 0 }) })

    await invalidateAdminRoleCaches(queryClient, fakeRole(), { nuxt, refreshMe, waitForAccessRefresh })

    expect(runWithContext).toHaveBeenCalledTimes(1)
    expect(runWithContext).toHaveBeenCalledWith(refreshMe)
    expect(refreshMe).toHaveBeenCalledTimes(1)
    expect(waitForAccessRefresh).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(['me'])?.isInvalidated).toBeFalsy()
    expect(queryClient.getQueryState(adminRoleKeys.all)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['access', 'users'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['access', 'audit'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryData(adminRoleKeys.detail(11))).toEqual({ id: 11 })
    queryClient.clear()
  })

  it('skips the me refresh when no Nuxt context was captured', async () => {
    const queryClient = new QueryClient()
    const refreshMe = vi.fn()
    await invalidateAdminRoleCaches(queryClient, fakeRole(), { nuxt: null, refreshMe })
    expect(refreshMe).not.toHaveBeenCalled()
    queryClient.clear()
  })

})

describe('admin role success waits for me refresh then access reset', () => {
  it('does not resolve while me refresh is still pending', async () => {
    const queryClient = new QueryClient()
    const refresh = deferred()
    const refreshMe = vi.fn(() => refresh.promise)
    const waitForAccessRefresh = vi.fn(async () => {})
    const nuxt: NuxtContextRunner = { runWithContext: <R>(fn: () => R) => fn() }

    let settled = false
    const done = invalidateAdminRoleCaches(queryClient, fakeRole(), { nuxt, refreshMe, waitForAccessRefresh }).then(() => { settled = true })
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
      mutationFn: async () => fakeRole(),
      onSuccess: (role) => invalidateAdminRoleCaches(queryClient, role, { nuxt, refreshMe, waitForAccessRefresh }),
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
