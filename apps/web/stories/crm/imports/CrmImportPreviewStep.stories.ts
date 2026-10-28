import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmImportPreviewStep from '../../../app/components/crm/imports/CrmImportPreviewStep.vue'
import { storyContext } from '../../support/context'
import { cleanPreview, preview } from './crmImportFixtures'

const meta = {
  title: 'CRM/CrmImportPreviewStep',
  component: CrmImportPreviewStep,
  parameters: storyContext('apps/web/app/components/crm/imports/CrmImportFlow.vue:169', 'معاينة الاستيراد: العدّادات والصفوف غير الصالحة وأرقام الصفوف المكررة فقط.'),
  args: { preview },
} satisfies Meta<typeof CrmImportPreviewStep>
export default meta
type Story = StoryObj<typeof meta>
export const WithProblems: Story = {}
export const Clean: Story = { args: { preview: cleanPreview } }
export const NothingNew: Story = { args: { preview: { new: 0, duplicate: 2, invalid: 0, invalid_rows: [], duplicate_rows: [2, 3] } } }
