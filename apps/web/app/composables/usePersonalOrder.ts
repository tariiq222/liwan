import { movePersonalCard, personalCardOrder, personalOrderKey } from './nav/personalOrder'
import { toValue, type MaybeRefOrGetter } from 'vue'

export function usePersonalOrder(available: MaybeRefOrGetter<string[]>) {
  const { me } = useMe()
  const hydrated = useHydrated()
  const saved = ref<unknown>(null)
  const failed = ref(false)
  const key = computed(() => hydrated.value ? personalOrderKey(me.value?.company.id, me.value?.id) : null)
  watch(key, value => {
    saved.value = null
    failed.value = false
    if (!import.meta.client || !value) return
    try { saved.value = JSON.parse(localStorage.getItem(value) ?? 'null') }
    catch { failed.value = true }
  }, { immediate: true, flush: 'sync' })
  const order = computed(() => personalCardOrder(toValue(available), saved.value))
  function move(id: string, direction: -1 | 1) {
    if (!key.value) return
    saved.value = movePersonalCard(order.value, id, direction)
    try { localStorage.setItem(key.value, JSON.stringify(saved.value)); failed.value = false }
    catch { failed.value = true }
  }
  return { order, move, failed }
}
