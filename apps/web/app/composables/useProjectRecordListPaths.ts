import { toValue, type MaybeRefOrGetter } from 'vue'
import { useRecordListPaths } from './useRecordListPaths'
import { planningSections, projectSections } from './nav/projectSections'
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
    const planning = sections.some(section => section.id === 'planning') ? planningSections(projectId, { active: true }) : []
    return [...toValue(owning), ...planning.map(section => section.to), ...sections.map(section => section.to), ...governance.map(section => section.to)]
  })
}
