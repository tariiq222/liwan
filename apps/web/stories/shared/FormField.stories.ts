import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import FormField from '@liwan/ui/app/components/shared/form/FormField.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FormField',
  component: FormField,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/vendor-admin/app/pages/ai-billing-settings.vue:101', 'غلاف الحقل الواحد فوق `UFormField`: الحقل المطلوب يُعلِن `aria-required` لقارئ الشاشة، والخطأ يظهر بعد مغادرة الحقل أو بعد محاولة الحفظ (`submitted`) لا أثناء الكتابة، والاسم `name` هدف رابط ملخص الأخطاء.'),
  },
  args: { name: 'rate', label: 'الريال لكل دولار أمريكي', help: 'مثل 3.75. حتى ست خانات عشرية.' },
} satisfies Meta<typeof FormField>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { FormField },
  setup() {
    const value = ref('')
    return { args, value }
  },
  template: `<div class="max-w-xs"><FormField v-bind="args"><UInput v-model="value" dir="ltr" inputmode="decimal" class="w-full" :disabled="args.disabled" /></FormField></div>`,
})

export const Default: Story = { name: 'افتراضي', render }
export const Required: Story = { name: 'مطلوب', args: { required: true }, render }
export const ErrorAfterSubmit: Story = { name: 'خطأ بعد محاولة الحفظ', args: { required: true, submitted: true, error: 'أدخل سعرًا موجبًا بست خانات عشرية على الأكثر، مثل 3.75.' }, render }
export const ErrorHiddenWhileTyping: Story = { name: 'خطأ مخفي قبل مغادرة الحقل', args: { required: true, error: 'أدخل سعرًا موجبًا بست خانات عشرية على الأكثر، مثل 3.75.' }, render }
