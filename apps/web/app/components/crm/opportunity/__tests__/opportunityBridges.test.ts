import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const link = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label'], setup: props => () => Vue.h('span', { 'data-badge': props.label }) })
const section = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', [slots.actions?.(), slots.default?.()]) })
const state = Vue.defineComponent({ props: ['empty', 'emptyText'], setup: (props, { slots }) => () => (props.empty ? Vue.h('p', props.emptyText as string) : slots.default?.()) })
const stubs = { NuxtLink: link, SharedStatusBadge: badge, SharedRecordSection: section, SharedPageState: state }
const messages = {
  'crm.opportunities.tasks.add': 'إضافة مهمة', 'crm.opportunities.tasks.empty': 'لا مهام', 'crm.opportunities.tasks.state.open': 'مفتوحة',
  'crm.opportunities.tasks.due': 'الموعد: {date}', 'crm.opportunities.meetings.add': 'إضافة اجتماع', 'crm.opportunities.meetings.empty': 'لا اجتماعات',
  'crm.opportunities.meetings.state.confirmed': 'مؤكد',
}
const render = (name: string, props: Record<string, unknown>) =>
  renderShared(resolve(import.meta.dirname, `../${name}.vue`), props, {}, { hydrated: true, messages, stubs, modules: { '@liwan/ui/app/composables/calendarDate': { formatCalendarDate: (value: string) => value.slice(0, 10) } } })

const task = { id: 5, name: 'اتصال متابعة', state: 'open', priority: 'normal', date_deadline: '2026-11-20T09:00:00Z', assignees: [{ id: 3, name: 'سعد' }], source: 'personal', project: null, href: '/my-tasks/5' }
const meeting = { id: 8, name: 'عرض المنتج', meeting_date: '2026-11-22', state: 'confirmed', organizer: { id: 3, name: 'سعد' } }

describe('CrmOpportunityTasks', () => {
  it('lists each task with its state, assignees and a link to /my-tasks/<id>', async () => {
    const html = await render('CrmOpportunityTasks', { tasks: [task], total: 1, canWrite: false })
    expect(html).toContain('href="/my-tasks/5"')
    expect(html).toContain('اتصال متابعة')
    expect(html).toContain('data-badge="مفتوحة"')
    expect(html).toContain('سعد')
  })

  it('offers the add button only to a writer, and says so when empty', async () => {
    expect(await render('CrmOpportunityTasks', { tasks: [], total: 0, canWrite: true })).toContain('data-testid="crm-task-add"')
    const reader = await render('CrmOpportunityTasks', { tasks: [], total: 0, canWrite: false })
    expect(reader).not.toContain('crm-task-add')
    expect(reader).toContain('لا مهام')
  })
})

describe('CrmOpportunityMeetings', () => {
  it('lists each meeting with its state and a link to the meeting page', async () => {
    const html = await render('CrmOpportunityMeetings', { meetings: [meeting], total: 1, canWrite: false })
    expect(html).toContain('href="/meetings/8"')
    expect(html).toContain('data-badge="مؤكد"')
  })

  it('offers the add button only to a writer', async () => {
    expect(await render('CrmOpportunityMeetings', { meetings: [meeting], total: 1, canWrite: true })).toContain('data-testid="crm-meeting-add"')
    expect(await render('CrmOpportunityMeetings', { meetings: [meeting], total: 1, canWrite: false })).not.toContain('crm-meeting-add')
  })
})
