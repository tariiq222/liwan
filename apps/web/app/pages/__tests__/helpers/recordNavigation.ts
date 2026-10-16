import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export * from '../../../utils/recordListOrigin'
export * from '../../../modules/meetings/navigation'
export * from '../../../modules/hr/navigation'

// Script tests supply no visible navigation; browser journeys exercise real
// authenticated cross-application sources through useRecordListPaths.
export function useRecordListPaths(paths: MaybeRefOrGetter<readonly string[]>) {
  return computed(() => toValue(paths))
}

export function useProjectRecordListPaths(id: MaybeRefOrGetter<number | null>, paths: MaybeRefOrGetter<readonly string[]>) {
  return computed(() => [...toValue(paths), ...['tasks', 'schedule', 'milestones', 'charter', 'stakeholders', 'raci', 'register', 'finance', 'meetings', 'updates'].map(section => `/projects/${toValue(id)}/${section}`)])
}
