import type { ShellCrumb } from '@webvue/ui/app/types/shell'

interface CrumbLevel { label: string, to: string }

/** The header trail: rail section, the section's tab when it has one, then the page title; the levels above the title link back once the page is deeper than the section. */
export function adminCrumbs(input: { section: CrumbLevel | null, tab: CrumbLevel | null, title: string | null }): ShellCrumb[] {
  const { section, tab, title } = input
  const deeper = Boolean(title && title !== section?.label)
  const trail: ShellCrumb[] = []
  if (section) trail.push({ label: section.label, to: deeper ? section.to : undefined })
  if (section && tab) trail.push({ label: tab.label, to: deeper ? tab.to : undefined })
  if (title && deeper) trail.push({ label: title })
  return trail
}
