import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MeetingTimeField from '../../app/components/meetings/MeetingTimeField.vue'
import { storyContext } from '../support/context'

// A 24-hour HH:MM entry so the meeting forms and the record page speak one clock.
const meta = {
  title: 'Meetings/MeetingTimeField',
  component: MeetingTimeField,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/meetings/new.vue:171', 'إدخال وقت الاجتماع بنظام 24 ساعة (HH:MM) في نماذج الإنشاء والتعديل وموعد السلسلة.'),
  },
} satisfies Meta<typeof MeetingTimeField>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { modelValue: '' } }
export const Filled: Story = { args: { modelValue: '15:30' } }
export const Disabled: Story = { args: { modelValue: '09:00', disabled: true } }
