import { resolve } from 'node:path'
import { ref, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@nasq/ui/test/helpers/renderShared'

async function overview(state: { data?: unknown[]; loading?: boolean; error?: Error }) {
  return renderShared(resolve(import.meta.dirname, '../ProjectOverview.vue'), { project: { id: 7, progress: 40, task_count: 3, closed_task_count: 1, milestone_count: 1 } }, {}, {
    globals: { useRoute: () => ({ fullPath: '/projects/7' }) },
    modules: {
      '@/composables/useMilestones': { useMilestones: () => ({ data: ref(state.data), isLoading: ref(!!state.loading), error: ref(state.error), refetch: () => {} }) },
      '@/composables/useProjectUpdates': { useProjectUpdates: () => ({ data: ref([]), isLoading: ref(false), error: ref(null) }) },
      '@nasq/ui/app/composables/calendarDate': { formatCalendarDate: (value: string) => value },
      '@/composables/projectStatus': { projectStatusBadge: () => ({ tone: 'neutral' }) },
      '@nasq/ui/app/utils/statusBadge': { badgeLabel: () => '' },
      './ProjectOverviewTasks.vue': { default: defineComponent({ setup: () => () => h('section', { 'data-testid': 'attention' }) }) },
    },
    stubs: { SharedMetricTile: defineComponent({ props: ['label','value','hint'], setup: props => () => h('div', `${props.label} ${props.value ?? ''} ${props.hint ?? ''}`) }) },
  })
}

describe('project overview milestone truthfulness', () => {
  it('does not claim no milestone while loading', async () => {
    const html = await overview({ loading: true })
    expect(html).not.toContain('projects.overview.noUpcomingMilestone')
  })
  it('does not claim no milestone after a failed request', async () => {
    const html = await overview({ error: new Error('unavailable') })
    expect(html).not.toContain('projects.overview.noUpcomingMilestone')
    expect(html).toContain('project-overview-milestone-error')
  })
  it('distinguishes all reached milestones from an unfinished one with no date', async () => {
    const reached = await overview({ data: [{ id: 1, is_reached: true, deadline: '2035-01-01', name: 'done' }] })
    expect(reached).toContain('projects.overview.noUpcomingMilestone')
    const undated = await overview({ data: [{ id: 1, is_reached: false, deadline: null, name: 'undated milestone' }] })
    expect(undated).toContain('undated milestone')
    expect(undated).not.toContain('projects.overview.noUpcomingMilestone')
  })
})
