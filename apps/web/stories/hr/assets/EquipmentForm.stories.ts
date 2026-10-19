import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import EquipmentForm from '../../../app/components/hr/assets/EquipmentForm.vue'
import CreatePanel from '@webvue/ui/app/components/shared/layout/CreatePanel.vue'
import { storyContext } from '../../support/context'

// The asset create form inside the /hr/assets/new SharedCreatePanel: it posts the exact
// request body and reports the created asset; the page owns the navigation.
const meta = {
  title: 'HR/Assets/EquipmentForm',
  component: EquipmentForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/assets/new.vue:28', 'نموذج إنشاء الأصل داخل `SharedCreatePanel`: `SharedFormSection panel` بالاسم والتصنيف والرقم التسلسلي والطراز وانتهاء الضمان، وتذييل واحد `SharedFormActions`.'),
  },
  args: {
    categories: [{ id: 2, name: 'حاسبات' }, { id: 3, name: 'هواتف' }],
    backTo: '/hr/assets',
  },
  render: args => ({
    components: { EquipmentForm, CreatePanel },
    setup: () => ({ args, t: useI18n().t }),
    template: '<CreatePanel :title="t(\'hrAssets.new\')" back-to="/hr/assets"><EquipmentForm v-bind="args" /></CreatePanel>',
  }),
} satisfies Meta<typeof EquipmentForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'نموذج الأصل' }
