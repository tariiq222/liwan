import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationLogCard from '../../app/components/settings/CommunicationLogCard.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'

const meta = {
  title: 'Settings/CommunicationLogCard', component: CommunicationLogCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications.vue:33', 'بطاقة سجل الرسائل: الفلاتر وقائمة الرسائل بحالاتها وتفاصيل الرسالة. تُعرض فقط لمن يملك صلاحية قراءة السجل.') },
  args: { canRetry: true },
  render: args => ({ components: { CommunicationLogCard }, setup: () => ({ args }), template: '<div class="max-w-4xl"><CommunicationLogCard v-bind="args" /></div>' }),
} satisfies Meta<typeof CommunicationLogCard>
export default meta
type Story = StoryObj<typeof meta>

export const Log: Story = { name: 'السجل', parameters: communicationHandlers() }
export const WithoutRetry: Story = { name: 'بلا صلاحية الإدارة', args: { canRetry: false }, parameters: communicationHandlers() }
export const Empty: Story = { name: 'فارغ', parameters: communicationHandlers({ messages: [] }) }
export const LoadFailed: Story = { name: 'تعذر التحميل', parameters: communicationHandlers({ messagesFailure: { status: 500, body: { code: 'server_error', message: 'تعذر التحميل' } } }) }
export const Forbidden: Story = { name: 'بلا صلاحية القراءة', parameters: communicationHandlers({ messagesFailure: { status: 403, body: { code: 'forbidden', message: 'ممنوع' } } }) }
