import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createError } from 'h3'
import { createHooks } from 'hookable'
import { MeSchema } from '@liwan/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { vueBindings } from '../../../tests/vueBindings'
import { describe, expect, it } from 'vitest'

const nuxtRoot = dirname(createRequire(import.meta.url).resolve('nuxt/package.json'))
// Execute the installed Nuxt functions, not a double of useFetch/useAsyncData.
// Bootstrap provides app context/build constants; only the HTTP transport is replaced.
function evaluate(source: string, bindings: Record<string, unknown>, server: boolean, result: string) {
  const code = source.replace(/^import[^\n]*\n/gm, '').replace(/^export \{[^\n]*\n/gm, '')
    .replace(/^export (?=function|const)/gm, '')
    .replace(/import\.meta\.server/g, String(server)).replace(/import\.meta\.client/g, String(!server))
    .replace(/import\.meta\.(dev|prerender)/g, 'false')
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return new Function(...Object.keys(bindings), `${compiled}\nreturn ${result}`)(...Object.values(bindings))
}
function installed(file: string, bindings: Record<string, unknown>, server: boolean, result: string) {
  return evaluate(readFileSync(resolve(nuxtRoot, file), 'utf8'), bindings, server, result)
}
const identity = (id = 5, companyId = 1) => ({
  id, name: `User ${id}`, login: `user-${id}`, email: `user-${id}@example.test`, lang: 'ar', tz: 'Asia/Riyadh',
  role: 'employee', company: { id: companyId, name: `Company ${companyId}` }, capabilities: ['hr.employees.read'],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function runtime(server: boolean, transport: (url: string, options: any) => unknown, cookie = 'scratch-session-a') {
  const hooks = createHooks()
  const app = {
    payload: Vue.shallowReactive({ data: Vue.shallowReactive({} as Record<string, unknown>), _errors: Vue.shallowReactive({} as Record<string, unknown>), serverRendered: true }),
    static: { data: {} }, isHydrating: false, _asyncData: Vue.shallowReactive({}), _asyncDataPromises: {}, hook: hooks.hook, hooks,
  }
  const debounceTick = installed('dist/app/utils/debounce-tick.js', { queuePostFlushCb: Vue.queuePostFlushCb }, server, 'debounceTick')
  const error = installed('dist/app/error.js', { createError$1: createError }, server, 'createError')
  const clientServerPrefetch = installed('dist/app/composables/server-prefetch.js', { getCurrentInstance: Vue.getCurrentInstance }, server, 'onServerPrefetch')
  const bindings = {
    ...vueBindings, useNuxtApp: () => app, createError: error, debounceTick, onServerPrefetch$1: clientServerPrefetch,
    defineKeyedFunctionFactory: (descriptor: { factory: unknown }) => descriptor.factory,
    asyncDataDefaults: { deep: false }, granularCachedData: true, pendingWhenIdle: false, purgeCachedData: true,
    stripNeverHydratedData: false, tracingChannelNuxt: false, vapor: false,
    clientOnlySymbol: Symbol('client-only'), neverHydratedSymbol: Symbol('never-hydrated'),
    toArray: (value: unknown) => Array.isArray(value) ? value : [value],
  }
  const asyncData = installed('dist/app/composables/asyncData.js', bindings, server, '({useAsyncData,useNuxtData,refreshNuxtData})')
  const useFetch = installed('dist/app/composables/fetch.js', {
    ...bindings, ...asyncData, $fetch: transport, useRequestFetch: () => transport,
    alwaysRunFetchOnKeyChange: false, fetchDefaults: {}, routeTypedFetch: false,
  }, server, 'useFetch')
  return { ...asyncData, useFetch, app, cookie }
}
function subject(server: boolean) {
  let active!: ReturnType<typeof runtime>
  const useMe = evaluate(readFileSync(resolve(import.meta.dirname, '../useMe.ts'), 'utf8'), {
    computed: Vue.computed, MeSchema,
    useRequestHeaders: () => server ? { cookie: active.cookie } : {},
    useNuxtData: (key: string) => active.useNuxtData(key),
    useNuxtApp: () => active.app,
    useFetch: (...args: any[]) => active.useFetch(...args),
  }, server, '({useMe,isSchemaError,isLoggedOutError})')
  const useAccess = evaluate(readFileSync(resolve(import.meta.dirname, '../useAccess.ts'), 'utf8'), {
    computed: Vue.computed, useMe: useMe.useMe,
    canReach: () => { throw new Error('Permission-policy execution is outside identity request tests') },
  }, server, 'useAccess')
  return { ...useMe, useAccess, inApp<T>(app: ReturnType<typeof runtime>, run: () => T): T { active = app; return run() } }
}

describe('useMe with installed Nuxt SSR async-data behavior', () => {
  it('reuses resolved identity for later SSR identity and access consumers', async () => {
    let requests = 0
    const app = runtime(true, () => { requests++; return identity() })
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    await first.ready
    const later = api.inApp(app, () => [api.useMe(), api.useMe(), api.useAccess()])
    await Promise.all(later.slice(0, 2).map((item: { ready: Promise<unknown> }) => item.ready))
    expect(requests).toBe(1)
    expect(first.me.value.id).toBe(5)
    expect(later[0].me.value.id).toBe(5)
    expect(later[2].capabilities.value).toEqual(['hr.employees.read'])
  })

  it('shares a pending SSR request without cancelling its transport', async () => {
    const held = deferred<ReturnType<typeof identity>>()
    const signals: AbortSignal[] = []
    const app = runtime(true, (_url, options) => { signals.push(options.signal); return held.promise })
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    const second = api.inApp(app, () => api.useMe())
    const started = signals.length
    const cancelledBeforeResolve = signals[0]!.aborted
    held.resolve(identity())
    await Promise.all([first.ready, second.ready])
    expect(started).toBe(1)
    expect(cancelledBeforeResolve).toBe(false)
    expect(first.me.value.id).toBe(5)
    expect(second.me.value.id).toBe(5)
  })

  it('explicit SSR refresh fetches new identity and updates every consumer', async () => {
    let requests = 0
    const app = runtime(true, () => { requests++; return identity(requests === 1 ? 5 : 6, requests === 1 ? 1 : 2) })
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    await first.ready
    const second = api.inApp(app, () => api.useMe())
    await second.ready
    await second.refresh()
    expect(requests).toBe(2)
    expect(first.me.value.id).toBe(6)
    expect(first.me.value.company.id).toBe(2)
    expect(second.me.value.id).toBe(6)
  })

  it.each([401, 403, 500])('failed refresh %s stays null despite an older successful payload', async statusCode => {
    let failure = false
    let requests = 0
    const app = runtime(true, () => {
      requests++
      if (failure) throw createError({ statusCode })
      return identity()
    })
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    await first.ready
    failure = true
    await first.refresh()
    const later = api.inApp(app, () => api.useMe())
    await later.ready
    expect(requests).toBe(2)
    expect(first.me.value).toBeNull()
    expect(later.me.value).toBeNull()
    expect(later.error.value.statusCode).toBe(statusCode)
    expect(api.isLoggedOutError(later.error.value)).toBe(statusCode !== 500)
    failure = false
    await later.refresh()
    expect(requests).toBe(3)
    expect(first.me.value.id).toBe(5)
  })

  it('retains a wrapped schema error after refresh and recovers only after a valid response', async () => {
    let malformed = false
    const app = runtime(true, () => malformed ? { ...identity(), lang: null } : identity())
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    await first.ready
    malformed = true
    await first.refresh()
    const later = api.inApp(app, () => api.useMe())
    await later.ready
    expect(later.me.value).toBeNull()
    expect(api.isSchemaError(later.error.value)).toBe(true)
    expect(api.isLoggedOutError(later.error.value)).toBe(false)
    malformed = false
    await later.refresh()
    expect(first.error.value).toBeUndefined()
    expect(first.me.value.id).toBe(5)
  })

  it.each([401, 403, 500])('initial identity failure %s preserves its error classification', async statusCode => {
    const app = runtime(true, () => { throw createError({ statusCode }) })
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    await first.ready
    expect(first.me.value).toBeNull()
    expect(first.loggedIn.value).toBe(false)
    expect(first.error.value.statusCode).toBe(statusCode)
    expect(api.isLoggedOutError(first.error.value)).toBe(statusCode !== 500)
  })

  it('reuses an explicitly null SSR result without treating it as signed in', async () => {
    let requests = 0
    const app = runtime(true, () => { requests++; return null })
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    await first.ready
    const second = api.inApp(app, () => api.useMe())
    await second.ready
    expect(requests).toBe(1)
    expect(first.me.value).toBeNull()
    expect(second.loggedIn.value).toBe(false)
    expect(second.error.value).toBeUndefined()
  })

  it('rejects a malformed initial identity through the real schema transform', async () => {
    const app = runtime(true, () => ({ ...identity(), lang: null }))
    const api = subject(true)
    const first = api.inApp(app, () => api.useMe())
    await first.ready
    expect(first.me.value).toBeNull()
    expect(first.loggedIn.value).toBe(false)
    expect(api.isSchemaError(first.error.value)).toBe(true)
    expect(api.isLoggedOutError(first.error.value)).toBe(false)
  })

  it('keeps client initial fetch and explicit refresh cancellation after a session change', async () => {
    const held = deferred<ReturnType<typeof identity>>()
    const signals: AbortSignal[] = []
    let requests = 0
    const app = runtime(false, (_url, options) => {
      signals.push(options.signal)
      return ++requests === 1 ? held.promise : identity(6, 2)
    })
    const api = subject(false)
    const first = api.inApp(app, () => api.useMe())
    await first.refresh()
    expect(requests).toBe(2)
    expect(signals[0]!.aborted).toBe(true)
    expect(first.me.value.id).toBe(6)
    expect(first.me.value.company.id).toBe(2)
    held.resolve(identity(5, 1))
    await first.ready
    expect(first.me.value.id).toBe(6)
  })

  it('separates concurrent SSR apps and forwards only each app own cookie', async () => {
    const a = deferred<ReturnType<typeof identity>>()
    const b = deferred<ReturnType<typeof identity>>()
    const cookies: string[] = []
    const api = subject(true) // One production module instance, two request contexts.
    const firstApp = runtime(true, (_url, options) => { cookies.push(options.headers.cookie); return a.promise }, 'scratch-session-a')
    const secondApp = runtime(true, (_url, options) => { cookies.push(options.headers.cookie); return b.promise }, 'scratch-session-b')
    const first = api.inApp(firstApp, () => api.useMe())
    const second = api.inApp(secondApp, () => api.useMe())
    b.resolve(identity(6, 2)); a.resolve(identity(5, 1))
    await Promise.all([first.ready, second.ready])
    expect(cookies).toEqual(['scratch-session-a', 'scratch-session-b'])
    expect(first.me.value.id).toBe(5)
    expect(first.me.value.company.id).toBe(1)
    expect(second.me.value.id).toBe(6)
    expect(second.me.value.company.id).toBe(2)
  })
})
