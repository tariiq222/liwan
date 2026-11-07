import { readFileSync } from 'node:fs'
import { useStorage } from '@vueuse/core'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { withTaskListFilters } from '../taskFilterParams'

// Run the production composable with VueUse's real storage lifecycle. A renderer without a DOM
// lets setup, beforeMount and mounted run in order without replacing the storage implementation.
function client(saved: Record<string, unknown>, route: Record<string, string> = {}) {
  let stored = JSON.stringify(saved)
  const storage: Storage = {
    getItem: () => stored, setItem: (_key, value) => { stored = value },
    removeItem: () => { stored = '' }, clear: () => { stored = '' }, key: () => null, length: 1,
  }
  const source = readFileSync(new URL('../useTaskFilters.ts', import.meta.url), 'utf8')
    .replace(/^import.*\n/gm, '').replace('export function', 'function').replace('useLocalStorage<TaskListParams>', 'useLocalStorage')
  const useTaskFilters = new Function('useLocalStorage', `${source}\nreturn useTaskFilters`)(
    (key: string, defaults: unknown, options: object) => useStorage(key, defaults, storage, options),
  )
  let initial: unknown
  let beforeMount: unknown
  let restored: unknown
  let selected: unknown
  let beforeStored: string | undefined
  const renderer = Vue.createRenderer<Record<string, unknown>, Record<string, unknown>>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert: () => {}, remove: () => {}, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: () => null, nextSibling: () => null,
  })
  const app = renderer.createApp({ setup() {
    const filters = useTaskFilters()
    initial = { ...filters.value }
    Vue.onBeforeMount(() => { beforeMount = { ...filters.value }; beforeStored = stored })
    Vue.onMounted(() => { restored = { ...filters.value }; selected = withTaskListFilters(filters.value, route) })
    return () => null
  } })
  app.mount({})
  app.unmount()
  return { initial, beforeMount, beforeStored, restored, selected, stored }
}

describe('task filter preferences during hydration', () => {
  it('uses the server defaults through beforeMount then restores saved preferences without overwriting them', () => {
    const saved = { closed: false, q: 'Saved search', project_id: 4 }
    const result = client(saved)
    expect(result.initial).toEqual({ closed: false })
    expect(result.beforeMount).toEqual({ closed: false })
    expect(result.beforeStored).toBe(JSON.stringify(saved))
    expect(result.restored).toEqual(saved)
    expect(result.stored).toBe(JSON.stringify(saved))
  })
  it('keeps an explicit URL filter above restored local preferences', () => {
    expect(client({ closed: false, q: 'Saved search', project_id: 4 }, { q: 'Linked search', project_id: '9' }).selected).toMatchObject({ q: 'Linked search', project_id: 9 })
  })
})
