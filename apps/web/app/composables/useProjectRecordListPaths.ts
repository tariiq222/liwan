import { toValue, type MaybeRefOrGetter } from 'vue'
import { useRecordListPaths } from './useRecordListPaths'
import { projectSections } from './nav/projectSections'
import { governanceSections } from './nav/governanceSections'
import { canReach } from '../utils/accessPolicy'

/** Existing readable sections of this project are valid cross-section journey sources. */
export function useProjectRecordListPaths(id: MaybeRefOrGetter<number | null>, owning: MaybeRefOrGetter<readonly string[]>) {
  const { me } = useMe()
  return useRecordListPaths(() => {
    const projectId = toValue(id)
    if (!projectId || !Number.isSafeInteger(projectId)) return toValue(owning)
    const sections = projectSections(projectId, me.value, { active: true })
      .filter(section => canReach(me.value, section.capability, section.to))
    const governance = sections.some(section => section.id === 'governance') ? governanceSections(projectId) : []
    return [...toValue(owning), ...sections.map(section => section.to), ...governance.map(section => section.to)]
  })
}
