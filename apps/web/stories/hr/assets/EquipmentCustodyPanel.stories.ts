import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import EquipmentCustodyPanel from '../../../app/components/hr/assets/EquipmentCustodyPanel.vue'
import RecordPage from '@webvue/ui/app/components/shared/layout/RecordPage.vue'
import { storyContext } from '../../support/context'

// The custody block of an asset record: the current holder and, when the asset is free,
// the assignment control. The page owns the mutation and the inline confirmations.
const meta = {
  title: 'HR/Assets/EquipmentCustodyPanel',
  component: EquipmentCustodyPanel,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/assets/[equipmentId].vue:216', 'كتلة العهدة في سجل الأصل: المُسلَّم إليه وتاريخ آخر تسليم، وضبط التسليم (الموظف والتاريخ) حين يكون الأصل غير مُسلَّم.'),
  },
  args: {
    equipment: {
      id: 5, name: 'MacBook Pro', category: { id: 2, name: 'حاسبات' }, serial_no: 'SN-001', model: 'M4',
      employee: null, assign_date: '2026-04-02', warranty_date: null, scrap_date: null, active: true,
    },
    employees: [{ id: 7, name: 'ليلى الحربي' }, { id: 8, name: 'عمر القحطاني' }],
    canManage: true,
    pending: false,
    onAssign: fn(),
  },
  render: args => ({
    components: { EquipmentCustodyPanel, RecordPage },
    setup: () => ({ args }),
    template: '<RecordPage title="MacBook Pro" back-to="/hr/assets"><EquipmentCustodyPanel v-bind="args" /></RecordPage>',
  }),
} satisfies Meta<typeof EquipmentCustodyPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Free: Story = { name: 'غير مُسلَّم' }

export const Assigned: Story = {
  name: 'مُسلَّم',
  args: {
    equipment: {
      id: 6, name: 'iPhone 17', category: { id: 3, name: 'هواتف' }, serial_no: 'SN-777', model: 'Pro',
      employee: { id: 7, name: 'ليلى الحربي' }, assign_date: '2026-05-01', warranty_date: '2027-01-01',
      scrap_date: null, active: true,
    },
  },
}
