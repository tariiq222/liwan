import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useRecordListPaths } from './useRecordListPaths'
import { useProject } from './useProjects'
import { planningSections, projectSections } from '../modules/pmo/projectSections'
import { governanceSections } from '../modules/pmo/governanceSections'
import { hasFeature } from '../modules/registry'
import { projectSectionAvailable } from '../utils/projectTools'
import { canReach } from '../utils/accessPolicy'

/** Existing readable sections of this project are valid cross-section journey sources. */
export function useProjectRecordListPaths(id: MaybeRefOrGetter<number | null>, owning: MaybeRefOrGetter<readonly string[]>) {
  const { me } = useMe()
  const readableId = computed(() => {
    const value = toValue(id)
    return value && Number.isSafeInteger(value) && canReach(me.value, 'pmo.projects.read', `/projects/${value}`) ? value : null
  })
  // Shares the frame's query; no project request is made for a task-only reader.
  const { data: project } = useProject(readableId)
  return useRecordListPaths(() => {
    const projectId = toValue(id)
    if (!projectId || !Number.isSafeInteger(projectId)) return toValue(owning)
    const tools = project.value?.tools
    const sections = projectSections(projectId, me.value, { active: project.value?.active ?? true, tools })
      .filter(section => canReach(me.value, section.capability, section.to))
    const governance = sections.some(section => section.id === 'governance')
      ? governanceSections(projectId, { changeControl: project.value?.change_control_mode !== 'off' && hasFeature(me.value, 'pmo.change_control') }) : []
    // The milestones and baselines pages open from the tasks (their timeline view), so they need the tasks section and the planning tool.
    const planning = sections.some(section => section.id === 'tasks') && projectSectionAvailable('planning', tools)
      ? planningSections(projectId, { active: project.value?.active ?? true, baselines: hasFeature(me.value, 'pmo.baselines') }) : []
    const secondary: string[] = []
    if (projectSectionAvailable('evm', tools) && hasFeature(me.value, 'pmo.evm')) secondary.push(`/projects/${projectId}/evm`)
    return [...toValue(owning), ...planning.map(section => section.to), ...sections.map(section => section.to), ...governance.map(section => section.to), ...secondary]
  })
}
