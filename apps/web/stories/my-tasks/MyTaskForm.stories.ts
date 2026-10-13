import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import MyTaskForm from '../../app/components/my-tasks/MyTaskForm.vue'
import { ApiError } from '../../app/composables/useApi'
import { storyContext } from '../support/context'

// One form for a personal task: the create page and the inline edit on the detail page. It emits
// the exact request body and runs no request itself; `pending` and `error` come from the parent.
const meta = {
  title: 'MyTasks/MyTaskForm',
  component: MyTaskForm,
  parameters: storyContext('apps/web/app/pages/my-tasks/new.vue:31', 'داخل لوحة الإنشاء `SharedCreatePanel`. يطلق `submit` بجسم الطلب نفسه، ولا يرسل `parent_id` أبدًا.'),
  args: { mode: 'create', initial: null, pending: false, error: null, onSubmit: fn(), onCancel: fn() },
  render: args => ({
    components: { MyTaskForm },
    setup: () => ({ args }),
    template: '<div class="max-w-xl"><MyTaskForm v-bind="args" /></div>',
  }),
} satisfies Meta<typeof MyTaskForm>
export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = { name: 'إنشاء مهمة' }

export const Pending: Story = { name: 'أثناء الحفظ', args: { pending: true } }

export const FieldError: Story = {
  name: 'خطأ من الخادم تحت الحقل',
  args: { error: new ApiError(422, 'invalid', 'عنوان المهمة مستخدم من قبل', 'name') },
}

export const GeneralError: Story = {
  name: 'خطأ عام',
  args: { error: new ApiError(500, 'http_error', 'تعذر حفظ المهمة. حاول مرة أخرى.') },
}

export const Edit: Story = {
  name: 'تعديل مهمة موجودة',
  parameters: storyContext('unused', 'نسخة التعديل لصفحة تفاصيل المهمة؛ ترسل كل الحقول لتمكين تفريغ الوصف والموعد والمسؤولين.'),
  args: {
    mode: 'edit',
    initial: {
      name: 'مراجعة تقرير الربع الثالث',
      description: 'تدقيق الأرقام وإرسال الملاحظات للفريق',
      date_deadline: '2026-10-20T00:00:00Z',
      priority: 'high',
      assignees: [{ id: 2, user_id: 2, name: 'المدير' }],
    },
  },
}
