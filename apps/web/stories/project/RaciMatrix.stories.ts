import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RaciMatrix from '../../app/components/pmo/projects/governance/RaciMatrix.vue'
import { storyContext } from '../support/context'
const meta = {
  title: 'Project/RaciMatrix', component: RaciMatrix,
  parameters: { ...storyContext('apps/web/app/pages/projects/[id]/raci.vue:111', 'مصفوفة مسؤوليات المهام وأصحاب المصلحة.'), a11y: { test: 'error' } },
  args: { projectId: 1, tasks: [{ id: 1, name: 'اعتماد الخطة' }, { id: 2, name: 'إطلاق المشروع' }], stakeholders: [{ id: 1, name: 'فريق التشغيل' }, { id: 2, name: 'الإدارة المالية' }], canManage: true, locked: false, returnTo: '/projects/1/raci' },
  render: args => ({ components: { RaciMatrix }, setup: () => ({ args, assignments: new Map([['1:1', { id: 1, task: { id: 1, name: 'اعتماد الخطة' }, stakeholder: { id: 1, name: 'فريق التشغيل' }, role: 'R' }]]) }), template: '<RaciMatrix v-bind="args" :assignments="assignments" />' }),
} satisfies Meta<typeof RaciMatrix>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const ReadOnly: Story = { args: { canManage: false } }
