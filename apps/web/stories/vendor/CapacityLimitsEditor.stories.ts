import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CapacityLimitsEditor from '../../app/components/vendor/CapacityLimitsEditor.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Vendor/CapacityLimitsEditor', component: CapacityLimitsEditor, parameters: { layout: 'padded', ...storyContext('apps/web/app/components/vendor/BundleForm.vue:87') },
  args: { keys: ['projects.max_projects', 'users.limit'], labels: { 'projects.max_projects': 'أقصى عدد للمشاريع', 'users.limit': 'المستخدمون' }, modelValue: { 'projects.max_projects': { mode: 'number', value: '20' }, 'users.limit': { mode: '', value: '' } } } } satisfies Meta<typeof CapacityLimitsEditor>
export default meta
type Story = StoryObj<typeof meta>
export const Mixed: Story = {}
export const ExplicitNone: Story = { args: { modelValue: { 'projects.max_projects': { mode: 'none', value: '' }, 'users.limit': { mode: 'unlimited', value: '' } } } }
export const Invalid: Story = { args: { showErrors: true } }
