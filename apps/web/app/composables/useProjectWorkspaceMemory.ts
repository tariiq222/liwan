import { projectEntryLocation, savedProjectLocation } from '@/utils/projectWorkspaceMemory'

/** Preferences are local to this browser, company and authenticated user. */
export function useProjectWorkspaceMemory() {
  const { me } = useMe()
  const hydrated = useHydrated()
  function key(id: number) {
    return me.value ? `nasq:project-location:v1:${me.value.company.id}:${me.value.id}:${id}` : null
  }
  function remember(path: string, query: Record<string, unknown>) {
    if (!import.meta.client || !hydrated.value) return
    const location = savedProjectLocation(path, query)
    if (!location) return
    const storageKey = key(Number(path.split('/')[2]))
    if (!storageKey) return
    try { localStorage.setItem(storageKey, JSON.stringify(location)) } catch { /* Storage can be disabled. */ }
  }
  function entryTo(id: number, origin: string, active = true) {
    let saved: unknown = null
    const storageKey = key(id)
    if (import.meta.client && hydrated.value && storageKey) {
      try { saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') } catch { /* Fall back to the normal project entry. */ }
    }
    const location = projectEntryLocation(id, origin, saved)
    // A changed role must not restore a task view it can no longer read.
    const taskSection = /\/(tasks|milestones|schedule)$/.test(location.path)
      || (location.path === `/projects/${id}` && !!location.query.tab && location.query.tab !== 'summary')
    if (!active || (!me.value?.capabilities.includes('pmo.tasks.read') && taskSection)) {
      return { path: `/projects/${id}`, query: { returnTo: location.query.returnTo, projectListReturnTo: location.query.projectListReturnTo } }
    }
    return location
  }
  return { remember, entryTo }
}
