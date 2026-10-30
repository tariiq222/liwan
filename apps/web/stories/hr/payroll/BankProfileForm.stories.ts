import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BankProfileForm from '../../../app/components/hr/payroll/BankProfileForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The bank and WPS file layouts on the payroll settings page: a shared profile is read-only, a company profile opens
// its form above the table (delimiter, encoding, header, footer and ordered columns) and is deleted after an inline
// confirmation.
const column = (source: string, label: string, constant_value = '') => ({ source, label, constant_value })
const profiles = [
  { id: 1, name: 'ملف بنكي عام', kind: 'bank', delimiter: ',', encoding: 'utf-8', include_header: true, footer: 'none', columns: [column('iban', 'IBAN'), column('net', 'Amount')], shared: true, revision: 1 },
  { id: 2, name: 'تحويل بنك الراجحي', kind: 'bank', delimiter: ';', encoding: 'utf-8-sig', include_header: false, footer: 'totals', columns: [column('iban', 'IBAN'), column('constant', 'Type', 'SAL')], shared: false, revision: 2 },
  { id: 3, name: 'مدد - حماية الأجور', kind: 'wps', delimiter: ',', encoding: 'utf-8', include_header: true, footer: 'none', columns: [column('identification', 'ID')], shared: true, revision: 1 },
]

const meta = {
  title: 'HR/Payroll/BankProfileForm',
  component: BankProfileForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:127', 'قسم تنسيقات ملفات البنك وحماية الأجور في إعدادات الرواتب: جدول الملفات، والملفات المشتركة للقراءة فقط، ونموذج الأعمدة.'),
  },
  args: { profiles, canEdit: true, reloadProfiles: async () => profiles },
  render: args => ({
    components: { BankProfileForm, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="list"><BankProfileForm v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof BankProfileForm>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canEdit: false } }

export const Empty: Story = { name: 'بلا ملفات تعريف', args: { profiles: [] } }
