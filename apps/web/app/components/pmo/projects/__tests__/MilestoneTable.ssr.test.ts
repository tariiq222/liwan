import { resolve } from 'node:path'
import { defineComponent, h, ref } from 'vue'
import { expect, it } from 'vitest'
import * as dates from '@internationalized/date'
import * as calendar from '@liwan/ui/app/composables/calendarDate'
import { ApiError } from '../../../../composables/useApi'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import * as milestoneState from '../milestoneState'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

it('links to the milestone record and keeps an explained disabled delete for linked tasks', async () => {
  const html = await renderShared(resolve(import.meta.dirname, '../MilestoneTable.vue'), { projectId: 1, canManage: true }, {}, {
    globals: {
      useRoute: () => ({ fullPath: '/projects/1/milestones' }), useToast: () => ({ add: () => {} }),
      useI18n: () => ({ locale: ref('en'), t: (key: string, args?: {count:number}) => args?.count ? `${key}:${args.count}` : key }),
    },
    modules: {
      './milestoneState': milestoneState, '@internationalized/date': dates, '@liwan/ui/app/composables/calendarDate': calendar, '@/composables/useApi': { ApiError }, '@liwan/ui/app/utils/safeReturnTo': { returnToQuery }, '@liwan/ui/app/utils/recordNumberHeader': { recordNumberHeader: () => 'number' },
      '@liwan/ui/app/components/shared/data/RecordNumber.vue': { default: defineComponent({ props: ['value'], setup: props => () => h('bdi', String(props.value)) }) },
      '@/composables/useMilestones': {
        useMilestones: () => ({ data: ref([{ id: 1, name: 'In use', start_date: null, deadline: null, deliverables: [{name:'output',done:false}], is_reached: false, task_count: 2, done_task_count: 1 }]), isLoading: ref(false), error: ref(null), refetch: () => {} }),
        useUpdateMilestone: () => ({ mutateAsync: () => {} }), useDeleteMilestone: () => ({ mutateAsync: () => {}, isPending: ref(false) }),
      },
    },
    stubs: {
      SharedListCard: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
      SharedProgress: defineComponent({ props: ['value'], setup: props => () => h('div', { 'data-progress': props.value }) }),
      SharedDataTable: defineComponent({ props: ['rows'], setup: (props, { slots }) => () => h('table', (props.rows as object[]).map(original => h('tr', [slots['number-cell']?.({row:{original}}), slots['name-cell']?.({row:{original}}), slots['tasks-cell']?.({row:{original}}), slots['actions-cell']?.({row:{original}})]))) }),
      SharedRowActions: defineComponent({ props: ['actions'], setup: props => () => h('div', (props.actions as {label:string;disabled?:boolean}[]).map(action => h('button', {disabled:action.disabled}, action.label))) }),
      NuxtLink: defineComponent({ props: ['to'], setup: (props,{slots}) => () => h('a', {href: props.to.path}, slots.default?.()) }),
    },
  })
  expect(html).toContain('href="/projects/1/milestones/1"')
  expect(html).toMatch(/<button disabled[^>]*>projects\.milestones\.deleteBlocked:2<\/button>/)
  expect(html).not.toContain('<USwitch')
  expect(html).toContain('data-progress="50"')
})
