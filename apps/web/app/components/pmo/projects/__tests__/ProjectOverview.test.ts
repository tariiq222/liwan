import { resolve } from 'node:path'
import { ref, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as safeReturnTo from '@liwan/ui/app/utils/safeReturnTo'

async function overview(state: { data?: unknown[]; loading?: boolean; error?: Error; canReadTasks?: boolean; active?: boolean; planning?: boolean; canManage?: boolean; updates?: unknown[] }) {
  const canReadTasks = state.canReadTasks ?? true
  return renderShared(resolve(import.meta.dirname, '../ProjectOverview.vue'), { project: { tools:{planning:{enabled:state.planning ?? true}}, objectives:[{id:1,goal:'Primary goal',metric:'count',target:'20'},{id:2,goal:'Second goal',metric:'',target:''}], success_criteria:'20 in one month', phase_state:null, id: 7, can_manage: state.canManage ?? true, active: state.active ?? true, progress: 40, task_count: 3, closed_task_count: 1, milestone_count: 1 } }, {}, {
    globals: { useHydrated: () => ref(true), useRoute: () => ({ fullPath: '/projects/7' }), useAccess: () => ({ can: (capability: string) => capability !== 'pmo.tasks.read' || canReadTasks }) },
    modules: {
      '@liwan/ui/app/utils/safeReturnTo': safeReturnTo,
      '@/composables/useMilestones': { useMilestones: () => ({ data: ref(state.data), isLoading: ref(!!state.loading), error: ref(state.error), refetch: () => {} }) },
      '@/composables/useProjectUpdates': { useProjectUpdates: () => ({ data: ref(state.updates ?? []), isLoading: ref(false), error: ref(null) }) },
      '@liwan/ui/app/composables/calendarDate': { formatCalendarDate: (value: string) => value },
      '@/composables/projectPhase': { isGateAction: () => false },
      '@/composables/projectStatus': { projectStatusBadge: () => ({ tone: 'neutral' }) },
      '@liwan/ui/app/utils/statusBadge': { badgeLabel: () => '' },
      './ProjectUpdateList.vue': { __esModule: true, default: { render: () => h('section', { 'data-testid': 'earlier-updates' }) } },
      './ProjectOverviewTasks.vue': { __esModule: true, default: { render: () => h('section', { 'data-testid': 'attention' }) } },
    },
    stubs: { SharedRecordSection: defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h('section', attrs, [slots.actions?.(), slots.default?.()]) }), SharedMetricTile: defineComponent({ props: ['label','value','hint'], setup: props => () => h('div', `${props.label} ${props.value ?? ''} ${props.hint ?? ''}`) }) },
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

describe('simple overview', () => {
 it('shows every core objective and success criteria with planning disabled', async () => {
 const html = await overview({planning:false,data:[]})
 expect(html).toContain('Primary goal');expect(html).toContain('Second goal');expect(html).toContain('20 in one month');expect(html).not.toContain('projects.overview.milestones')
 })
})

describe('project overview updates', () => {
  const latest = { id: 2, name: 'Latest news', status: 'on_track', date: '2035-02-01', description_html: '<p>body</p>', author: { id: 1, name: 'Ali' } }
  it('puts the latest update, with its post action, before the earlier ones and the basics', async () => {
    const html = await overview({ data: [], updates: [latest] })
    expect(html).toContain('Latest news')
    expect(html).toContain('data-testid="project-updates-create"')
    expect(html.indexOf('project-overview-latest-update')).toBeLessThan(html.indexOf('earlier-updates'))
    expect(html.indexOf('earlier-updates')).toBeLessThan(html.indexOf('project-overview-basics'))
    expect(html).not.toContain('projects.refresh.workspace.viewAllUpdates')
  })
  it('says there are no updates yet and still offers the post action', async () => {
    const html = await overview({ data: [] })
    expect(html).toContain('projects.overview.noUpdates')
    expect(html).toContain('project-updates-create')
  })
  it('offers no post action to a reader or on an archived project', async () => {
    expect(await overview({ data: [], canManage: false })).not.toContain('project-updates-create')
    expect(await overview({ data: [], active: false })).not.toContain('project-updates-create')
  })
})
