import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mounted: Array<() => void> = []
vi.mock('vue', async (importOriginal) => ({ ...(await importOriginal<typeof import('vue')>()), onMounted: (fn: () => void) => { mounted.push(fn) } }))
const { useAiNowSection } = await import('../useAiNowSection')

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } })
  return store
}
const setup = () => { mounted.length = 0; const section = effectScope().run(() => useAiNowSection())!; mounted.forEach(fn => fn()); return section }

afterEach(() => vi.unstubAllGlobals())

describe('useAiNowSection', () => {
  it('starts shown', () => {
    stubStorage()
    expect(setup().hidden.value).toBe(false)
  })

  it('hides and shows, remembering the choice for the session', () => {
    const store = stubStorage()
    const section = setup()
    section.toggle()
    expect(section.hidden.value).toBe(true)
    expect(store.get('webvue-assistant-now-hidden')).toBe('hidden')
    section.toggle()
    expect(section.hidden.value).toBe(false)
    expect(store.get('webvue-assistant-now-hidden')).toBe('shown')
  })

  it('comes back hidden when the session says so', () => {
    stubStorage({ 'webvue-assistant-now-hidden': 'hidden' })
    expect(setup().hidden.value).toBe(true)
  })

  it('works without storage', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    const section = setup()
    expect(section.hidden.value).toBe(false)
    section.toggle()
    expect(section.hidden.value).toBe(true)
  })
})
