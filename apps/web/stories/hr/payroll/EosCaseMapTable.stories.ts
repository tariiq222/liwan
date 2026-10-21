import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EosCaseMapTable from '../../../app/components/hr/payroll/EosCaseMapTable.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The end-of-service case of each departure reason in the payroll settings. A choice is saved at once; the row being
// saved waits, and a reason without a case is shown as not mapped.
const mappings = [
  { departure_reason: { id: 1, name: 'استقالة' }, case: 'resignation' },
  { departure_reason: { id: 2, name: 'انتهاء العقد' }, case: null },
] as const

const meta = {
  title: 'HR/Payroll/EosCaseMapTable',
  component: EosCaseMapTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/settings.vue:85', 'جدول حالات نهاية الخدمة في إعدادات الرواتب: الحالة التي يُحسب بها استحقاق كل سبب مغادرة.'),
  },
  args: { mappings: [...mappings], canEdit: true, saving: [] },
  render: args => ({
    components: { EosCaseMapTable, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><EosCaseMapTable v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof EosCaseMapTable>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }

export const Saving: Story = { name: 'حفظ صف قيد التنفيذ', args: { saving: [2] } }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canEdit: false } }

export const Empty: Story = { name: 'بلا أسباب', args: { mappings: [] } }
