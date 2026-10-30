import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollFileActions from '../../../app/components/hr/payroll/PayrollFileActions.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The salary files of a fixed run under its totals: the bank transfer file with its value date, the WPS file, each laid
// out by a profile, and the link to the GOSI statement. A download stays pending until the server answers.
const column = (source: string, label: string) => ({ source, label, constant_value: '' })
const profiles = [
  { id: 1, name: 'ملف بنكي عام', kind: 'bank', delimiter: ',', encoding: 'utf-8', include_header: true, footer: 'none', columns: [column('iban', 'IBAN'), column('net', 'Amount')], shared: true },
  { id: 2, name: 'تحويل بنك الراجحي', kind: 'bank', delimiter: ';', encoding: 'utf-8-sig', include_header: false, footer: 'totals', columns: [column('iban', 'IBAN')], shared: false },
  { id: 3, name: 'مدد - حماية الأجور', kind: 'wps', delimiter: ',', encoding: 'utf-8', include_header: true, footer: 'none', columns: [column('identification', 'ID')], shared: true },
]

const meta = {
  title: 'HR/Payroll/PayrollFileActions',
  component: PayrollFileActions,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/index.vue:257', 'ملفات الرواتب في صفحة المسير المعتمد: ملف التحويل البنكي بتاريخ القيمة، وملف حماية الأجور، ورابط كشف التأمينات الاجتماعية.'),
  },
  args: { profiles, profilesReady: true, pending: null, writable: true, defaultDate: '2026-11-01', gosiTo: '/hr/payroll/1/gosi' },
  render: args => ({
    components: { PayrollFileActions, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="full"><PayrollFileActions v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollFileActions>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'جاهزة' }

export const DownloadingBank: Story = { name: 'تنزيل الملف البنكي', args: { pending: 'bank' } }

export const NoProfiles: Story = { name: 'بلا ملفات تعريف', args: { profiles: [] } }

export const ProfilesUnavailable: Story = { name: 'التنسيقات غير متاحة', args: { profiles: [], profilesReady: false } }

export const ReadOnlyTenant: Story = { name: 'مساحة العمل للقراءة فقط', args: { writable: false } }
