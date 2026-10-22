import { computed, getCurrentScope, onScopeDispose, watch } from 'vue'
import { pinnableModules } from './nav/sidebarModel'
import { visibleShellModules } from './nav/shellModules'

const STORAGE_PREFIX = 'webvue.pins.v1:'

/** The stored pins, or null when nothing usable is stored (never chosen, or garbage). */
export function parseStoredPins(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return null
    return [...new Set(value.filter((id): id is string => typeof id === 'string'))]
  } catch { return null }
}

/**
 * What the rail shows: every reachable application in manifest order until the user chooses, then the stored pins
 * that are still reachable. An application added later is not pinned for someone who has chosen.
 */
export function effectivePins(stored: readonly string[] | null, reachable: readonly string[]): string[] {
  return stored === null ? [...reachable] : stored.filter(id => reachable.includes(id))
}

export function toggledPins(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter(pin => pin !== id) : [...current, id]
}

/**
 * Moves a pin by `delta` places among `among` (the pins on show; every pin by default), so a hidden pin is stepped
 * over rather than counted; a move past either end leaves the order as it is.
 */
export function movedPins(current: readonly string[], id: string, delta: number, among: readonly string[] = current): string[] {
  const order = among.filter(pin => current.includes(pin))
  const from = order.indexOf(id)
  const target = order[from + delta]
  if (from < 0 || from + delta < 0 || target === undefined) return [...current]
  const next = current.filter(pin => pin !== id)
  next.splice(next.indexOf(target) + (delta > 0 ? 1 : 0), 0, id)
  return next
}

/**
 * The applications pinned to the rail for the signed-in user, kept in this browser (per user id, per device). The
 * server and the first client render show the default; the stored choice is read once the page has hydrated, and a
 * change made in another tab is picked up. A stored pin of an application the user cannot reach now is kept, only
 * hidden, so it comes back when access does.
 */
export function useAppPins() {
  const { me } = useMe()
  const hydrated = useHydrated()
  const stored = useState<string[] | null>('webvue.pins', () => null)
  const loadedFor = useState<number | null>('webvue.pins.owner', () => null)
  const userId = computed(() => me.value?.id ?? null)
  const reachable = computed(() => pinnableModules(visibleShellModules(me.value)).map(module => module.id))
  const pinned = computed(() => effectivePins(stored.value, reachable.value))
  const storageKey = () => `${STORAGE_PREFIX}${userId.value}`

  function read() {
    try { stored.value = parseStoredPins(localStorage.getItem(storageKey())) } catch { stored.value = null }
  }
  function onStorage(event: StorageEvent) {
    if (userId.value !== null && (event.key === null || event.key === storageKey())) read()
  }
  let listening = false
  watch([hydrated, userId], () => {
    if (!hydrated.value || userId.value === null) return
    if (!listening) {
      listening = true
      window.addEventListener('storage', onStorage)
      if (getCurrentScope()) onScopeDispose(() => window.removeEventListener('storage', onStorage))
    }
    if (loadedFor.value === userId.value) return
    read()
    loadedFor.value = userId.value
  }, { immediate: true })

  function save(next: string[]) {
    stored.value = next
    if (userId.value === null) return
    try { localStorage.setItem(storageKey(), JSON.stringify(next)) } catch { /* storage unavailable: the choice lasts for this page view only */ }
  }
  const current = () => stored.value ?? reachable.value

  return {
    pinned,
    toggle: (id: string) => save(toggledPins(current(), id)),
    /** `among` is the pins on show (a filtered list); the move is relative to them. */
    move: (id: string, delta: number, among: readonly string[] = pinned.value) => save(movedPins(current(), id, delta, among)),
  }
}
