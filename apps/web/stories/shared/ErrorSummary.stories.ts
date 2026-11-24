import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ErrorSummary from '@liwan/ui/app/components/shared/form/ErrorSummary.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ErrorSummary',
  component: ErrorSummary,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/vendor-admin/app/pages/ai-billing-settings.vue:81', 'ملخص أخطاء النموذج أعلاه بعد محاولة حفظ فاشلة: سطر لكل خطأ برابط ينقل التركيز إلى أول عنصر غير صالح في حقله، والصفحة تستدعي `focus()` مرة واحدة بعد الرفض. لا يُرسم شيء حين تكون القائمة فارغة.'),
  },
  args: {
    title: 'راجع الحقول التالية قبل الحفظ',
    errors: [
      { field: 'amounts', message: 'أدخل مبلغًا بالريال بخانتين عشريتين على الأكثر.' },
      { field: 'minimum', message: 'أدخل أقل مبلغ بالريال؛ يجب ألا يقل أي مبلغ معروض عنه.' },
      { field: 'reason', message: 'اكتب سببًا من ثلاثة أحرف على الأقل.' },
    ],
  },
} satisfies Meta<typeof ErrorSummary>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'افتراضي' }
export const SingleError: Story = { name: 'خطأ واحد', args: { errors: [{ field: 'reason', message: 'اكتب سببًا من ثلاثة أحرف على الأقل.' }] } }
export const NoErrors: Story = { name: 'بلا أخطاء (لا يُرسم)', args: { errors: [] } }
