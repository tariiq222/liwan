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

/** One open branch: siblings replace each other while ancestors stay open. Paths include the owning application. */
export function useNavigationPathDisclosure(active: Readonly<Ref<string[]>>, routeKey: Readonly<Ref<string>>, collapsed: Readonly<Ref<boolean>>, paths: Readonly<Ref<string[][]>>) {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index])
  const valid = (path: string[]) => paths.value.some(allowed => same(path, allowed))
  function trim(path: string[]) {
    const next = [...path]
    while (next.length && !valid(next)) next.pop()
    return next
  }
  const routedPath = () => collapsed.value ? [] : trim(active.value)
  const openPath = ref<string[]>(routedPath())
  function setOpen(path: string[], open: boolean) {
    if (open && valid(path)) openPath.value = [...path]
    else if (!open && path.every((id, index) => openPath.value[index] === id)) openPath.value = trim(path.slice(0, -1))
  }
  // A new model object with the same active path must not undo a manual close.
  watch([() => JSON.stringify(active.value), routeKey, collapsed], () => { openPath.value = routedPath() })
  watch(paths, () => { openPath.value = trim(openPath.value) })
  return { openPath, setOpen }
}
