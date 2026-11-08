import { ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import OptionCards from '@liwan/ui/app/components/shared/form/OptionCards.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/OptionCards',
  component: OptionCards,
  parameters: {
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/settings/ProjectSettingsForm.vue:216', 'خيارات موصوفة، تعمل كمجموعة راديو أصلية وتبيّن سبب تعطيل الخيار.'),
  },
  args: {
    label: 'ضبط التغيير',
    modelValue: 'optional',
    options: [
      { value: 'off', label: 'متوقف', description: 'لا طلبات تغيير.' },
      { value: 'optional', label: 'اختياري', description: 'يمكن رفع الطلبات دون منع التعديل.' },
      { value: 'required', label: 'إلزامي', disabled: true, disabledReason: 'يتطلب تفعيل أداة الحوكمة.' },
    ],
  },
  render: args => ({
    components: { OptionCards },
    setup: () => ({ args, selected: ref(args.modelValue) }),
    template: '<OptionCards v-bind="args" v-model="selected" />',
  }),
} satisfies Meta<typeof OptionCards>

export default meta
type Story = StoryObj<typeof meta>
export const WithDisabledOption: Story = { name: 'خيارات مع سبب تعطيل' }
