// Browser-only stand-ins for the Nuxt runtime APIs that app components,
// composables and utils actually call. The list of names Storybook auto-imports
// from here is derived from .nuxt/imports.d.ts (see nuxt-imports.mjs); only the
// implementations below are hand-written, and they are the drift surface.
import { ref, shallowRef, toValue, type Ref } from 'vue'
import type { Router } from 'vue-router'
import { ofetch } from 'ofetch'

export { useRoute, useRouter } from 'vue-router'
// Storybook has no head manager; preview.ts applies the <html> attributes and
// brand theme itself, so a component's useHead() is a no-op here.
export function useHead(_input?: unknown, _options?: unknown) { return { patch: () => {}, dispose: () => {} } }

// --- fetch (MSW intercepts window.fetch underneath) -----------------------
export const $fetch = ofetch.create({})
export function useRequestHeaders(_keys?: string[]): Record<string, string> { return {} }
// Browser-only: there is never a server request event in Storybook.
export function useRequestEvent(): undefined { return undefined }

// --- app / config ----------------------------------------------------------
let router: Router | null = null
export function __setRouter(r: Router) { router = r }
export function __getRouter(): Router | null { return router }
const nuxtApp = {
  isHydrating: false,
  payload: {},
  hooks: { hook: () => () => {} },
  hook: () => () => {},
  runWithContext: <T>(fn: () => T) => fn(),
}
export function useNuxtApp() { return nuxtApp }
export function tryUseNuxtApp() { return nuxtApp }
export function useRuntimeConfig() { return { app: { baseURL: '/' }, public: { wsUrl: '' } } }
export function navigateTo(to: Parameters<Router['push']>[0], _opts?: unknown) { return router?.push(to) }

// --- state / cookie --------------------------------------------------------
const states = new Map<string, Ref>()
export function useState<T>(key: string, init?: () => T): Ref<T> {
  if (!states.has(key)) states.set(key, ref(init ? init() : undefined))
  return states.get(key) as Ref<T>
}
export function __resetState() { states.clear(); asyncData.clear() }

export function useCookie<T>(name: string, opts: { default?: () => T } = {}): Ref<T> {
  const raw = document.cookie.split('; ').find(c => c.startsWith(`${name}=`))?.slice(name.length + 1)
  let initial: T | undefined
  try { initial = raw ? JSON.parse(decodeURIComponent(raw)) : undefined } catch { initial = raw as T }
  return useState<T>(`cookie:${name}`, () => initial ?? (opts.default?.() as T))
}

// --- async data (useFetch key cache used by useMe/useBranding) -------------
type Entry = { data: Ref<unknown>; error: Ref<unknown>; status: Ref<string>; refresh: () => Promise<void> }
const asyncData = new Map<string, Entry>()
function entry(key: string): Entry {
  if (!asyncData.has(key)) asyncData.set(key, { data: shallowRef(null), error: shallowRef(null), status: ref('idle'), refresh: async () => {} })
  return asyncData.get(key)!
}
export function useFetch<T>(url: string | (() => string), opts: { key?: string; transform?: (raw: any) => T; query?: unknown; headers?: unknown; method?: string; body?: unknown } = {}) {
  const key = opts.key ?? toValue(url)
  const e = entry(key)
  e.refresh = async () => {
    e.status.value = 'pending'
    try {
      const raw = await $fetch(toValue(url), { method: opts.method as any, body: opts.body as any, query: toValue(opts.query as any) })
      e.data.value = opts.transform ? opts.transform(raw) : raw
      e.error.value = null
      e.status.value = 'success'
    } catch (err: any) {
      e.error.value = Object.assign(err ?? {}, { statusCode: err?.statusCode ?? err?.response?.status })
      e.status.value = 'error'
    }
  }
  if (e.status.value === 'idle') void e.refresh()
  const result = { data: e.data as Ref<T | null>, error: e.error, status: e.status, pending: ref(false), refresh: () => e.refresh(), execute: () => e.refresh() }
  return Object.assign(Promise.resolve(result), result)
}
// useAsyncData runs its handler once per key (browser only); MSW answers the underlying requests.
export function useAsyncData<T>(key: string, handler: () => Promise<T>, opts: { default?: () => T } = {}) {
  const e = entry(key)
  e.refresh = async () => {
    e.status.value = 'pending'
    try { e.data.value = await handler(); e.error.value = null; e.status.value = 'success' } catch (err) { e.error.value = err; e.status.value = 'error' }
  }
  if (e.data.value === null && opts.default) e.data.value = opts.default()
  if (e.status.value === 'idle') void e.refresh()
  const result = { data: e.data as Ref<T | null>, error: e.error, status: e.status, pending: ref(false), refresh: () => e.refresh(), execute: () => e.refresh() }
  return Object.assign(Promise.resolve(result), result)
}
export function useNuxtData<T>(key: string) { return { data: entry(key).data as Ref<T | null> } }
export async function refreshNuxtData(keys?: string | string[]) {
  const list = keys === undefined ? [...asyncData.keys()] : [keys].flat()
  await Promise.all(list.map(k => asyncData.get(k)?.refresh()))
}

// --- built-in Nuxt components used by app components ------------------------
import { defineComponent, h, onMounted as _onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
export const NuxtLink = defineComponent({
  name: 'NuxtLink',
  inheritAttrs: false,
  props: { to: { type: [String, Object], default: undefined }, href: { type: String, default: undefined }, external: Boolean, target: String },
  setup(props, { slots, attrs }) {
    return () => (props.external || props.href || (typeof props.to === 'string' && /^[a-z]+:/i.test(props.to)))
      ? h('a', { ...attrs, href: props.href ?? props.to, target: props.target }, slots.default?.())
      : h(RouterLink, { ...attrs, to: props.to ?? '/' }, slots)
  },
})
export const ClientOnly = defineComponent({
  name: 'ClientOnly',
  setup(_, { slots }) {
    const mounted = ref(false)
    _onMounted(() => { mounted.value = true })
    return () => (mounted.value ? slots.default?.() : slots.fallback?.() ?? slots.placeholder?.())
  },
})
export const NuxtPage = RouterView
