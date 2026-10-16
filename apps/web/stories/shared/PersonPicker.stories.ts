import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import PersonPicker from '../../app/components/shared/form/PersonPicker.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PersonPicker',
  component: PersonPicker,
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectCharterFields.vue:238', 'يبحث في /api/v1/people. `options` يقصر الاختيار على قائمة ثابتة مثل مشاركي الاجتماع.'),
  args: { modelValue: null, multiple: false, valueKey: 'user_id', placeholder: 'اختر المدير' },
  render: args => ({
    components: { PersonPicker },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<div class="grid max-w-sm gap-1"><span class="text-sm font-medium text-highlighted">المدير</span><PersonPicker v-bind="args" v-model="value" /></div>',
  }),
} satisfies Meta<typeof PersonPicker>
export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = { name: 'اختيار واحد' }
export const Multiple: Story = { name: 'اختيار متعدد', parameters: storyContext('apps/web/app/components/pmo/tasks/AssigneePicker.vue:34'), args: { multiple: true, modelValue: [], valueKey: 'id', placeholder: 'المسؤولون' } }
export const FixedOptions: Story = {
  name: 'من قائمة ثابتة',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/resolutions/new.vue:77'),
  args: { options: [{ id: 11, name: 'أحمد العتيبي' }, { id: 12, name: 'نورة الحربي' }], placeholder: 'المسؤول' },
}
