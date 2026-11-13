import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LockedApplication from '../../app/components/subscription/LockedApplication.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Subscription/LockedApplication', component: LockedApplication, parameters: { layout: 'padded', ...storyContext('apps/web/app/error.vue:71') },
  args: { application: 'إدارة العملاء', cause: 'not_in_plan', audience: 'manager', dataPath: null, heading: true } } satisfies Meta<typeof LockedApplication>
export default meta
type Story = StoryObj<typeof meta>
export const NotInPlanManager: Story = {}
export const NotInPlanMember: Story = { args: { audience: 'member' } }
export const PaymentSuspendedManager: Story = { args: { cause: 'payment_suspended', dataPath: '/crm' } }
export const PaymentSuspendedMember: Story = { args: { cause: 'payment_suspended', audience: 'member', dataPath: '/crm' } }
export const ReadOnlyReadable: Story = { args: { cause: 'read_only', dataPath: '/crm' } }
export const NonSaas: Story = { args: { cause: 'not_enabled', audience: 'non_saas' } }
export const NoApplicationName: Story = { args: { application: null } }
