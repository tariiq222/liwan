import type { Meta, StoryObj } from '@storybook/vue3-vite'
import EquipmentTable from '../../../app/components/hr/assets/EquipmentTable.vue'
import ListCard from '@webvue/ui/app/components/shared/layout/ListCard.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The equipment table of /hr/assets: one row per asset with its category, holder and
// state pill, inside the page's SharedListCard. Static fixtures, no requests.
const equipment = [
  {
    id: 5, name: 'MacBook Pro', category: { id: 2, name: 'حاسبات' }, serial_no: 'SN-001', model: 'M4',
    employee: { id: 7, name: 'ليلى الحربي' }, assign_date: '2026-05-01', warranty_date: null,
    scrap_date: null, active: true,
  },
  {
    id: 6, name: 'iPhone 17', category: { id: 3, name: 'هواتف' }, serial_no: 'SN-777', model: 'Pro',
    employee: null, assign_date: '2026-04-02', warranty_date: '2027-01-01', scrap_date: null, active: true,
  },
  {
    id: 7, name: 'Router', category: null, serial_no: '', model: '', employee: null,
    assign_date: null, warranty_date: null, scrap_date: '2026-09-30', active: false,
  },
]

const meta = {
  title: 'HR/Assets/EquipmentTable',
  component: EquipmentTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/assets.vue:220', 'جدول الأصول داخل بطاقة القائمة: الاسم والرقم التسلسلي، والتصنيف، والمُسلَّم إليه، وتاريخ التسليم، وحالة الأصل.'),
  },
  args: { equipment, rowTo: () => '/hr/assets/5', caption: 'العهد والأصول' },
  render: args => ({
    components: { EquipmentTable, ListCard, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><ListCard><EquipmentTable v-bind="args" /></ListCard></PageContainer></main>',
  }),
} satisfies Meta<typeof EquipmentTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'جدول الأصول' }

export const Loading: Story = { name: 'أثناء التحميل', args: { loading: true } }
