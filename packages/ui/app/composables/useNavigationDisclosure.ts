import { ref, watch, type Ref } from 'vue'

export function useNavigationDisclosure(active: Readonly<Ref<string | null>>, routeKey: Readonly<Ref<string>>, collapsed: Readonly<Ref<boolean>>, ids: Readonly<Ref<string[]>>) {
  const routedId = () => !collapsed.value && active.value && ids.value.includes(active.value) ? active.value : null
  const openId = ref<string | null>(routedId())
  function setOpen(id: string, open: boolean) {
    if (open && ids.value.includes(id)) openId.value = id
    else if (!open && openId.value === id) openId.value = null
  }
  watch([active, routeKey, collapsed], () => { openId.value = routedId() })
  watch(ids, allowed => { if (openId.value && !allowed.includes(openId.value)) openId.value = null })
  return { openId, setOpen }
}
