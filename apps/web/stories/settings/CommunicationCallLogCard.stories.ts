import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CommunicationCallLogCard from '../../app/components/settings/CommunicationCallLogCard.vue'
import { storyContext } from '../support/context'
import { communicationHandlers } from './communicationHandlers'

const meta = {
  title: 'Settings/CommunicationCallLogCard', component: CommunicationCallLogCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/integrations/communications.vue:34', 'بطاقة سجل المكالمات: الفلاتر وقائمة المكالمات بحالاتها ومدتها، وتفاصيل المكالمة بمرجع التسجيل بلا مشغّل صوت. تُعرض فقط لمن يملك صلاحية قراءة السجل.') },
  args: {},
  render: () => ({ components: { CommunicationCallLogCard }, template: '<div class="max-w-4xl"><CommunicationCallLogCard /></div>' }),
} satisfies Meta<typeof CommunicationCallLogCard>
export default meta
type Story = StoryObj<typeof meta>

export const Log: Story = { name: 'السجل', parameters: communicationHandlers() }
export const Empty: Story = { name: 'فارغ', parameters: communicationHandlers({ calls: [] }) }
export const LoadFailed: Story = { name: 'تعذر التحميل', parameters: communicationHandlers({ callsFailure: { status: 500, body: { code: 'server_error', message: 'تعذر التحميل' } } }) }
export const Forbidden: Story = { name: 'بلا صلاحية القراءة', parameters: communicationHandlers({ callsFailure: { status: 403, body: { code: 'forbidden', message: 'ممنوع' } } }) }
