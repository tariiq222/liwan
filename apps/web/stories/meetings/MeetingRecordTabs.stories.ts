import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MeetingRecordTabs from '../../app/components/meetings/MeetingRecordTabs.vue'
import { storyContext } from '../support/context'

const labels = ['نظرة عامة', 'المحضر', 'التوصيات (3)', 'المرفقات (2)', 'السجل']
const keys = ['summary', 'minutes', 'resolutions', 'attachments', 'history']
const tabs = (active: string) => keys.map((key, index) => ({ key: `meeting-tab-${key}`, label: labels[index]!, to: { query: { tab: key }, hash: '' }, active: key === active }))

const meta = {
  title: 'Meetings/MeetingRecordTabs',
  component: MeetingRecordTabs,
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:174'),
  args: { tabs: tabs('summary'), logTabStart: 4, label: 'أقسام الاجتماع' },
} satisfies Meta<typeof MeetingRecordTabs>
export default meta
type Story = StoryObj<typeof meta>

export const Summary: Story = { name: 'تبويب الملخص' }

export const LogTab: Story = {
  name: 'تبويب السجل بعد الفاصل',
  args: { tabs: tabs('history') },
}
