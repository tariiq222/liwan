import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmSettingsCard from '../../../app/components/crm/settings/CrmSettingsCard.vue'
import { storyContext } from '../../support/context'

const meta = {
  title: 'CRM/CrmSettingsCard',
  component: CrmSettingsCard,
  parameters: storyContext('apps/web/app/components/crm/settings/CrmFollowupCard.vue:25', 'إطار بطاقة إعدادات العملاء: الحفظ وإعادة التحميل عند التعارض، وحقول البطاقة في الفتحة.'),
  args: {
    title: 'المتابعة', description: 'ما يحدث بعد مكالمة بلا نتيجة نهائية.', canEdit: true,
    dirty: false, saving: false, reloading: false, conflict: false, message: '', reloadFailed: false,
  },
  render: args => ({
    components: { CrmSettingsCard },
    setup: () => ({ args }),
    template: `<CrmSettingsCard v-bind="args"><UFormField label="محاولات إضافية" name="attempts"><UInputNumber :model-value="2" class="w-full" /></UFormField></CrmSettingsCard>`,
  }),
} satisfies Meta<typeof CrmSettingsCard>
export default meta
type Story = StoryObj<typeof meta>
export const Clean: Story = {}
export const Dirty: Story = { args: { dirty: true } }
export const ReadOnly: Story = { args: { canEdit: false } }
export const SaveError: Story = { args: { dirty: true, message: 'تعذّر حفظ الإعدادات الآن' } }
export const Conflict: Story = { args: { dirty: true, conflict: true, message: 'تغيّرت إعدادات العملاء منذ فتحت الصفحة. أعد التحميل ثم كرّر التعديل.' } }
