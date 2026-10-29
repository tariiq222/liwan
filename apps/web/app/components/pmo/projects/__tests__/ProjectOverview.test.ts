import { resolve } from 'node:path'
import { ref, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@webvue/ui/test/helpers/renderShared'

async function overview(state: { data?: unknown[]; loading?: boolean; error?: Error; canReadTasks?: boolean; active?: boolean }) {
  const canReadTasks = state.canReadTasks ?? true
  return renderShared(resolve(import.meta.dirname, '../ProjectOverview.vue'), { project: { id: 7, active: state.active ?? true, progress: 40, task_count: 3, closed_task_count: 1, milestone_count: 1 } }, {}, {
    globals: { useRoute: () => ({ fullPath: '/projects/7' }), useAccess: () => ({ can: (capability: string) => capability !== 'pmo.tasks.read' || canReadTasks }) },
    modules: {
      '@/composables/useMilestones': { useMilestones: () => ({ data: ref(state.data), isLoading: ref(!!state.loading), error: ref(state.error), refetch: () => {} }) },
      '@/composables/useProjectUpdates': { useProjectUpdates: () => ({ data: ref([]), isLoading: ref(false), error: ref(null) }) },
      '@webvue/ui/app/composables/calendarDate': { formatCalendarDate: (value: string) => value },
      '@/composables/projectPhase': { isGateAction: () => false },
      '@/composables/projectStatus': { projectStatusBadge: () => ({ tone: 'neutral' }) },
      '@webvue/ui/app/utils/statusBadge': { badgeLabel: () => '' },
      './ProjectOverviewTasks.vue': { default: { render: () => h('section', { 'data-testid': 'attention' }) } },
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

describe('project overview tasks section', () => {
  it('shows the attention card and task tile to a reader of tasks', async () => {
    const html = await overview({ data: [] })
    expect(html).toContain('data-testid="attention"')
    expect(html).toContain('projects.overview.openTasks')
  })
  it('skips the tasks card, tile and completion hint without pmo.tasks.read', async () => {
    const html = await overview({ data: [], canReadTasks: false })
    expect(html).not.toContain('data-testid="attention"')
    expect(html).not.toContain('projects.overview.openTasks')
    expect(html).not.toContain('projects.overview.completedOf')
  })
  it('has no attention card on an archived project', async () => {
    const html = await overview({ data: [], active: false })
    expect(html).not.toContain('data-testid="attention"')
  })
})
