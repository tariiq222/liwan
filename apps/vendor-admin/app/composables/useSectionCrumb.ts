interface SectionCrumb { owner: string, label: string, to: string }

/** The breadcrumb level between the rail section and the page title (the catalog's active tab), registered by the section's parent page. */
export function useSectionCrumbState() {
  return useState<SectionCrumb | null>('admin-section-crumb', () => null)
}

export function useSectionCrumb(crumb: () => { label: string, to: string } | null) {
  const state = useSectionCrumbState()
  const owner = useId()
  watch(crumb, (next) => { state.value = next ? { owner, ...next } : null }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { if (state.value?.owner === owner) state.value = null })
}
