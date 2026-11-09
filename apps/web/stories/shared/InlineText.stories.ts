import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import InlineText from '@liwan/ui/app/components/shared/form/InlineText.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/InlineText',
  component: InlineText,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/pmo/tasks/TaskTitleEditor.vue:17', 'قيمة تُقرأ نصًا وتُحرَّر في مكانها: النص زر باسم الحقل؛ Enter أو مغادرة الحقل تحفظ، وEscape يعيد القيمة المحفوظة والتركيز إلى الزر. لا يرسل شيئًا: الحدث `save` يسلّم المسودة للتطبيق.'),
  },
  args: { modelValue: 'إعداد تقرير الربع الثالث', label: 'تعديل العنوان', editable: true },
} satisfies Meta<typeof InlineText>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { InlineText },
  setup() {
    const value = ref(args.modelValue)
    return { args, value }
  },
  template: `<InlineText v-bind="args" :model-value="value" @save="value = $event" />`,
})

export const Editable: Story = { name: 'قابل للتحرير', render }
export const ReadOnly: Story = { name: 'للقراءة فقط', args: { editable: false }, render }
export const Empty: Story = { name: 'فارغ', args: { modelValue: '', placeholder: 'غير محدد' }, render }
