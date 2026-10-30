import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ref } from 'vue'
import { expect, it, vi } from 'vitest'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function loadGuard(client = true, suspended = false) {
  const ready = deferred()
  const notification = deferred()
  const me = ref<unknown>(suspended ? null : { id: 1 })
  const refresh = vi.fn(async () => { me.value = { id: 2 } })
  const callHook = vi.fn(() => notification.promise)
  const canReachPath = vi.fn(() => true)
  const appRootFallback = vi.fn((): string | null => null)
  const planDenialCode = vi.fn((): string | null => null)
  const bindings = {
    defineNuxtRouteMiddleware: (handler: unknown) => handler,
    useNuxtApp: () => ({ $i18n: { t: (key: string) => key }, callHook }),
    useMe: () => ({ me, error: ref(suspended ? { statusCode: 403, data: { code: 'tenant_suspended' } } : null), ready: ready.promise, refresh }),
    canReachPath,
    appRootFallback,
    planDenialCode,
    isLoggedOutError: () => suspended,
    isTenantSuspendedError: () => suspended,
    isSchemaError: () => false,
    createError: (input: object) => Object.assign(new Error(), input),
    navigateTo: vi.fn(),
  }
  const source = readFileSync(new URL('../auth.global.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replaceAll('import.meta.client', String(client))
    .replace('export default', 'return')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const guard = new Function(...Object.keys(bindings), code)(...Object.values(bindings)) as (to: { path: string; fullPath: string; meta?: { access?: string } }) => Promise<unknown>
  return { ...bindings, guard, ready, notification, refresh, callHook, canReachPath, appRootFallback, planDenialCode }
}

it('publishes the actual client target before readiness and waits for listeners before refreshing identity', async () => {
  const view = loadGuard()
  const to = { path: '/projects/2/finance/51', fullPath: '/projects/2/finance/51?q=budget' }
  const navigation = view.guard(to)
  expect(view.callHook).toHaveBeenCalledWith('liwan:navigation:start', to)
  view.ready.resolve()
  await Promise.resolve()
  expect(view.refresh).not.toHaveBeenCalled()
  view.notification.resolve()
  await navigation
  expect(view.refresh).toHaveBeenCalledTimes(1)
  expect(view.canReachPath).toHaveBeenCalledWith({ id: 2 }, to.path)
})

it('still rejects a forbidden destination using the refreshed identity', async () => {
  const view = loadGuard()
  view.canReachPath.mockReturnValue(false)
  view.notification.resolve()
  view.ready.resolve()
  await expect(view.guard({ path: '/hr', fullPath: '/hr' })).rejects.toMatchObject({ statusCode: 403 })
  expect(view.refresh).toHaveBeenCalledTimes(1)
  expect(view.canReachPath).toHaveBeenCalledWith({ id: 2 }, '/hr')
})

it('names the plan, not permissions, when the plan closes the page', async () => {
  const view = loadGuard()
  view.canReachPath.mockReturnValue(false)
  view.planDenialCode.mockReturnValue('feature_not_included')
  view.notification.resolve()
  view.ready.resolve()
  await expect(view.guard({ path: '/hr', fullPath: '/hr' })).rejects.toMatchObject({ statusCode: 403, data: { code: 'feature_not_included' } })
})

it('marks a permission closure as forbidden', async () => {
  const view = loadGuard()
  view.canReachPath.mockReturnValue(false)
  view.notification.resolve()
  view.ready.resolve()
  await expect(view.guard({ path: '/hr', fullPath: '/hr' })).rejects.toMatchObject({ statusCode: 403, data: { code: 'forbidden' } })
})

it('does not publish a client navigation or refresh identity during SSR', async () => {
  const view = loadGuard(false)
  view.ready.resolve()
  await view.guard({ path: '/projects', fullPath: '/projects' })
  expect(view.callHook).not.toHaveBeenCalled()
  expect(view.refresh).not.toHaveBeenCalled()
  expect(view.canReachPath).toHaveBeenCalledWith({ id: 1 }, '/projects')
})

it('sends a session the API ended for a suspended tenant to the login page with the reason', async () => {
  const view = loadGuard(false, true)
  view.ready.resolve()
  await view.guard({ path: '/projects', fullPath: '/projects?q=x' })
  expect(view.navigateTo).toHaveBeenCalledWith({ path: '/login', query: { reason: 'tenant_suspended' } })
})

it('opens a public page without waiting for, or depending on, the identity', async () => {
  const view = loadGuard(true, true)
  await view.guard({ path: '/pay/invoice/7', fullPath: '/pay/invoice/7?access_token=x', meta: { access: 'public' } })
  expect(view.callHook).not.toHaveBeenCalled()
  expect(view.navigateTo).not.toHaveBeenCalled()
})

it('sends a signed-in visitor of a guest page home and lets a signed-out one stay', async () => {
  const signedIn = loadGuard()
  signedIn.notification.resolve()
  signedIn.ready.resolve()
  await signedIn.guard({ path: '/login', fullPath: '/login', meta: { access: 'guest' } })
  expect(signedIn.navigateTo).toHaveBeenCalledWith('/')
  const signedOut = loadGuard(true, true)
  signedOut.notification.resolve()
  signedOut.ready.resolve()
  await signedOut.guard({ path: '/login', fullPath: '/login', meta: { access: 'guest' } })
  expect(signedOut.navigateTo).not.toHaveBeenCalled()
})

it('replaces an app root the identity cannot open with its first allowed page', async () => {
  const view = loadGuard()
  view.appRootFallback.mockReturnValue('/finance/payments')
  view.notification.resolve()
  view.ready.resolve()
  await view.guard({ path: '/finance', fullPath: '/finance' })
  expect(view.appRootFallback).toHaveBeenCalledWith({ id: 2 }, '/finance')
  expect(view.navigateTo).toHaveBeenCalledWith('/finance/payments', { replace: true })
  expect(view.canReachPath).not.toHaveBeenCalled()
})
