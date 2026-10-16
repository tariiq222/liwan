import { resolve } from 'node:path'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@nasq/ui/test/helpers/renderShared'
import { ApiError } from '../../composables/useApi'
import { parsePositiveId } from '../../utils/routeParams'
import { owningListBack, recordChildTo } from '../../utils/recordListOrigin'

async function renderRecord(status?: number, source: 'project' | 'milestones' = 'milestones') {
  const denied = status ? new ApiError(status, 'forbidden', 'Read access withdrawn') : null
  const milestone = { id: 8, name: 'Private cached milestone', task_count: 0, done_task_count: 0, deliverables: [], is_reached: false }
  return renderShared(resolve(import.meta.dirname, '../projects/[id]/milestones/[milestoneId].vue'), {}, {}, {
    globals: {
      useRoute: () => ({ path: '/projects/7/milestones/8', params: { id: '7', milestoneId: '8' }, query: {}, hash: '' }),
      useRouter: () => ({}), useProjectRecordListPaths: () => ref(['/projects/7/milestones']),
    },
    modules: {
      '@/composables/useApi': { ApiError },
      '@/composables/useProjects': { useProject: () => ({ data: ref({ id: 7, active: true, can_manage: true }), error: ref(source === 'project' ? denied : null), isLoading: ref(false) }) },
      '@/composables/useMilestones': {
        useMilestones: () => ({ data: ref([milestone]), error: ref(source === 'milestones' ? denied : null), isLoading: ref(false) }),
        useUpdateMilestone: () => ({ isPending: ref(false) }), useDeleteMilestone: () => ({ isPending: ref(false) }),
      },
      '@/utils/recordListOrigin': { owningListBack, recordChildTo },
      '@/utils/routeParams': { parsePositiveId },
      '@nasq/ui/app/composables/calendarDate': { formatCalendarDate: () => '' },
    },
    stubs: {
      SharedRecordPage: defineComponent({ props: ['title'], setup: props => () => h('section', [h('h2', props.title)]) }),
      NuxtPage: defineComponent({ setup: () => () => null }),
    },
  })
}
describe('milestone record read withdrawal', () => {
  it('shows the cached name while the record remains readable', async () => {
    expect(await renderRecord()).toContain('Private cached milestone')
  })
  for (const source of ['project', 'milestones'] as const) it.each([403, 404])(`hides the cached title when ${source} returns %i`, async status => {
    expect(await renderRecord(status, source)).not.toContain('Private cached milestone')
  })
})
