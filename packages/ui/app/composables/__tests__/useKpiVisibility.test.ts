import * as Vue from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { KPI_COOKIE, useKpiVisibility, type KpiVisibility } from '../useKpiVisibility'

// Nuxt's useCookie/useState, reduced to what the composable needs: one cookie ref and one shared state ref.
const globals = globalThis as Record<string, unknown>
let cookie: Vue.Ref<KpiVisibility>
let state: Vue.Ref<KpiVisibility> | undefined
let cookieName = ''

function mount(initial: unknown) {
  state = undefined
  cookie = Vue.ref(initial ?? 'shown') as Vue.Ref<KpiVisibility>
  globals.useCookie = (name: string) => { cookieName = name; return cookie }
  globals.useState = (_key: string, init: () => KpiVisibility) => (state ??= Vue.ref(init()) as Vue.Ref<KpiVisibility>)
  return useKpiVisibility()
}

describe('useKpiVisibility', () => {
  beforeEach(() => { cookieName = '' })

  it('shows the strips by default and reads the webvue-kpis cookie', () => {
    expect(mount(undefined).shown.value).toBe(true)
    expect(cookieName).toBe(KPI_COOKIE)
    expect(KPI_COOKIE).toBe('webvue-kpis')
  })

  it('starts hidden from a hidden cookie, and treats any other value as shown', () => {
    expect(mount('hidden').shown.value).toBe(false)
    expect(mount('garbage').shown.value).toBe(true)
  })

  it('toggle flips the shared state and writes the cookie', () => {
    const kpis = mount('shown')
    const other = useKpiVisibility()
    kpis.toggle()
    expect(kpis.shown.value).toBe(false)
    expect(other.shown.value).toBe(false)
    expect(cookie.value).toBe('hidden')
    kpis.set(true)
    expect(other.shown.value).toBe(true)
    expect(cookie.value).toBe('shown')
  })
})
