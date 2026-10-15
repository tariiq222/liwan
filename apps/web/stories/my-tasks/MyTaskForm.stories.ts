import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import MyTaskForm from '../../app/components/personal-tasks/MyTaskForm.vue'
import { personalTask } from '../../e2e/my-tasks-fixtures.mjs'
import { ApiError } from '../../app/composables/useApi'
import { storyContext } from '../support/context'

// The create form of a personal task. It emits the exact request body and runs no request itself;
// `pending` and `error` come from the parent.
const meta = {
  title: 'MyTasks/MyTaskForm',
  component: MyTaskForm,
  parameters: storyContext('apps/web/app/pages/my-tasks/new.vue:43', 'داخل لوحة الإنشاء `SharedCreatePanel`. يطلق `create` بجسم الطلب نفسه، ولا يرسل `parent_id` أبدًا.'),
  args: { pending: false, error: null, onCreate: fn(), onUpdate: fn(), onCancel: fn() },
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

export const Edit: Story = { name: 'تعديل مهمة', args: { task: personalTask(7) } }
