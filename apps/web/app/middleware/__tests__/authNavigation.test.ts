import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ref } from 'vue'
import { expect, it, vi } from 'vitest'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function loadGuard(client = true) {
  const ready = deferred()
  const notification = deferred()
  const me = ref<unknown>({ id: 1 })
  const refresh = vi.fn(async () => { me.value = { id: 2 } })
  const callHook = vi.fn(() => notification.promise)
  const canReachPath = vi.fn(() => true)
  const bindings = {
    defineNuxtRouteMiddleware: (handler: unknown) => handler,
    useNuxtApp: () => ({ $i18n: { t: (key: string) => key }, callHook }),
    useMe: () => ({ me, error: ref(null), ready: ready.promise, refresh }),
    canReachPath,
    isLoggedOutError: () => false,
    isSchemaError: () => false,
    createError: (input: object) => Object.assign(new Error(), input),
    navigateTo: vi.fn(),
  }
  const source = readFileSync(new URL('../auth.global.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replaceAll('import.meta.client', String(client))
    .replace('export default', 'return')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const guard = new Function(...Object.keys(bindings), code)(...Object.values(bindings)) as (to: { path: string; fullPath: string }) => Promise<unknown>
  return { ...bindings, guard, ready, notification, refresh, callHook, canReachPath }
}

it('publishes the actual client target before readiness and waits for listeners before refreshing identity', async () => {
  const view = loadGuard()
  const to = { path: '/projects/2/finance/51', fullPath: '/projects/2/finance/51?q=budget' }
  const navigation = view.guard(to)
  expect(view.callHook).toHaveBeenCalledWith('webvue:navigation:start', to)
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

it('does not publish a client navigation or refresh identity during SSR', async () => {
  const view = loadGuard(false)
  view.ready.resolve()
  await view.guard({ path: '/projects', fullPath: '/projects' })
  expect(view.callHook).not.toHaveBeenCalled()
  expect(view.refresh).not.toHaveBeenCalled()
  expect(view.canReachPath).toHaveBeenCalledWith({ id: 1 }, '/projects')
})
