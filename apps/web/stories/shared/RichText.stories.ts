import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RichText from '../../app/components/shared/form/RichText.vue'
import { storyContext } from '../support/context'

const sample = '<h2>اعتماد نطاق المرحلة الأولى</h2><p>اكتملت مراجعة النطاق مع <a href="https://example.test">فريق العمل</a>، وتقرر:</p><ul><li>تحديد موعد اعتماد الخطة.</li><li>تجميد المتطلبات الجديدة حتى نهاية الشهر.</li></ul><blockquote>ملاحظة: يلزم توقيع الراعي.</blockquote><script>alert(1)</script>'

const meta = {
  title: 'Shared/RichText',
  component: RichText,
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectUpdateList.vue:64', 'العارض الوحيد لـ HTML مخزّن. ينقّي المحتوى دائمًا (الوسم script في المثال يُحذف) ويطبّق تنسيقًا واحدًا.'),
  args: { html: sample, size: 'md' },
  render: args => ({
    components: { RichText },
    setup: () => ({ args }),
    template: '<div class="max-w-2xl rounded-lg ring ring-default bg-default p-5"><RichText v-bind="args" /></div>',
  }),
} satisfies Meta<typeof RichText>
export default meta
type Story = StoryObj<typeof meta>

export const Document: Story = { name: 'مستند' }
export const Preview: Story = { name: 'معاينة داخل بطاقة', args: { size: 'sm' } }
