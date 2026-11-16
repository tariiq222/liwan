import { toValue, type MaybeRefOrGetter } from 'vue'
import { RAIL_PINS_COOKIE, railPinsOwner, resolveRailPins, savedRailPins, toggleRailPin, type RailPinsCookie } from './nav/railPins'

/** A cookie, read during SSR so the first paint already shows the person's own rail. */
export function useRailPins(available: MaybeRefOrGetter<string[]>) {
  const { me } = useMe()
  const cookie = useCookie<RailPinsCookie | null>(RAIL_PINS_COOKIE, { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const stored = useState<RailPinsCookie | null>('rail-pins', () => cookie.value)
  const owner = computed(() => railPinsOwner(me.value?.company.id, me.value?.id))
  const pins = computed(() => resolveRailPins(toValue(available), savedRailPins(stored.value, owner.value)))
  function toggle(id: string) {
    if (!owner.value) return
    stored.value = { owner: owner.value, ids: toggleRailPin(pins.value, id) }
    cookie.value = stored.value
  }
  return { pins, toggle }
}
