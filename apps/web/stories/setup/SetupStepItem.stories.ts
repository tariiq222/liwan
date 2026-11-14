import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SetupStepItem from '../../app/components/setup/SetupStepItem.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Setup/StepItem',
  component: SetupStepItem,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/pages/setup.vue:46', 'خطوة واحدة في قائمة الإعداد: ما تفيده بجملة واحدة وحالتها والإجراء الذي يفتح الصفحة المالكة للعمل، مع «تمت» و«تخطَّ».'),
  },
  args: { stepKey: 'team', outcome: null, access: { kind: 'open', to: '/settings/team/users' }, busy: false },
  render: args => ({ components: { SetupStepItem }, setup: () => ({ args }), template: '<ol class="mx-auto max-w-3xl"><SetupStepItem v-bind="args" /></ol>' }),
} satisfies Meta<typeof SetupStepItem>
export default meta
type Story = StoryObj<typeof meta>

export const Todo: Story = { name: 'للإنجاز' }
export const Done: Story = { name: 'منجزة', args: { outcome: 'done' } }
export const Skipped: Story = { name: 'متخطّاة', args: { outcome: 'skipped' } }
export const NoPage: Story = { name: 'بلا صفحة (النشاط)', args: { stepKey: 'sector', access: { kind: 'none' } } }
export const AppNotInPlan: Story = { name: 'التطبيق خارج الباقة', args: { stepKey: 'channels', access: { kind: 'feature' } } }
export const NoPermission: Story = { name: 'بلا صلاحية الصفحة', args: { stepKey: 'contacts', access: { kind: 'permission' } } }
