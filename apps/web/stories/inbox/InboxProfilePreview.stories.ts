import type { Meta, StoryObj } from '@storybook/vue3-vite'
import InboxProfilePreview from '../../app/components/inbox/InboxProfilePreview.vue'
import { storyContext } from '../support/context'

const full = {
  about: 'عيادة الأمل: رعاية أسنان لكل العائلة.', address: 'الرياض، طريق الملك فهد', description: 'نقدم خدمات الأسنان العامة والتجميلية بمواعيد مرنة طوال الأسبوع.',
  email: 'info@clinic.example.test', websites: ['https://clinic.example.test', 'https://book.clinic.example.test'], vertical: 'health' as const, pictureUrl: null,
}

const meta = {
  title: 'Inbox/InboxProfilePreview',
  component: InboxProfilePreview,
  parameters: storyContext('apps/web/app/components/inbox/InboxBusinessProfileForm.vue:124', 'معاينة بطاقة النشاط التجاري على واتساب بحسب المسودة قبل حفظها في ميتا.'),
  args: { name: 'عيادة الأمل', profile: full },
} satisfies Meta<typeof InboxProfilePreview>
export default meta
type Story = StoryObj<typeof meta>
export const Complete: Story = {}
export const AboutOnly: Story = { args: { profile: { ...full, address: '', description: '', email: '', websites: ['', ''], vertical: '' } } }
export const NothingYet: Story = { args: { profile: { ...full, about: '', address: '', description: '', email: '', websites: ['', ''], vertical: '' } } }
export const LongText: Story = { args: { profile: { ...full, about: 'نبذة طويلة '.repeat(12), description: 'وصف طويل جدًا '.repeat(30) } } }
