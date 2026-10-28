import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmImportUploadStep from '../../../app/components/crm/imports/CrmImportUploadStep.vue'
import { storyContext } from '../../support/context'

const meta = {
  title: 'CRM/CrmImportUploadStep',
  component: CrmImportUploadStep,
  parameters: storyContext('apps/web/app/components/crm/imports/CrmImportFlow.vue:160', 'الخطوة الأولى من الاستيراد: اختيار ملف CSV أو XLSX.'),
} satisfies Meta<typeof CrmImportUploadStep>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Reading: Story = { args: { reading: true } }
export const Refused: Story = { args: { error: 'الملف أكبر من 5 ميغابايت.' } }
