import { defineComponent, h, ref } from 'vue'
import { expect, it } from 'vitest'
import * as dates from '@internationalized/date'
import * as calendar from '../../../../composables/calendarDate'
import { ApiError } from '../../../../composables/useApi'
import { returnToQuery } from '../../../../utils/safeReturnTo'
import { renderShared } from '../../../shared/__tests__/helpers/renderShared'

it('links to the milestone record and keeps an explained disabled delete for linked tasks', async () => {
  const html = await renderShared('../pmo/projects/MilestoneTable', { projectId: 1, canManage: true }, {}, {
    globals: {
      useRoute: () => ({ fullPath: '/projects/1/milestones' }), useToast: () => ({ add: () => {} }),
      useI18n: () => ({ locale: ref('en'), t: (key: string, args?: {count:number}) => args?.count ? `${key}:${args.count}` : key }),
    },
    modules: {
      '@internationalized/date': dates, '@/composables/calendarDate': calendar, '@/composables/useApi': { ApiError }, '@/utils/safeReturnTo': { returnToQuery },
      '@/composables/useMilestones': {
        useMilestones: () => ({ data: ref([{ id: 1, name: 'In use', start_date: null, deadline: null, deliverables: [{name:'output',done:false}], is_reached: false, task_count: 2, done_task_count: 1 }]), isLoading: ref(false), error: ref(null), refetch: () => {} }),
        useUpdateMilestone: () => ({ mutateAsync: () => {} }), useDeleteMilestone: () => ({ mutateAsync: () => {}, isPending: ref(false) }),
      },
    },
    stubs: {
      SharedDataTable: defineComponent({ props: ['rows'], setup: (props, { slots }) => () => h('table', (props.rows as object[]).map(original => h('tr', [slots['name-cell']?.({row:{original}}), slots['actions-cell']?.({row:{original}})]))) }),
      SharedRowActions: defineComponent({ props: ['actions'], setup: props => () => h('div', (props.actions as {label:string;disabled?:boolean}[]).map(action => h('button', {disabled:action.disabled}, action.label))) }),
      NuxtLink: defineComponent({ props: ['to'], setup: (props,{slots}) => () => h('a', {href: props.to.path}, slots.default?.()) }),
    },
  })
  expect(html).toContain('href="/projects/1/milestones/1"')
  expect(html).toMatch(/<button disabled[^>]*>projects\.milestones\.deleteBlocked:2<\/button>/)
  expect(html).not.toContain('<USwitch')
})
