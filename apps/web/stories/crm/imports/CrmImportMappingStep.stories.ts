import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmImportMappingStep from '../../../app/components/crm/imports/CrmImportMappingStep.vue'
import { storyContext } from '../../support/context'
import { columns, profiles, sources } from './crmImportFixtures'

const meta = {
  title: 'CRM/CrmImportMappingStep',
  component: CrmImportMappingStep,
  parameters: storyContext('apps/web/app/components/crm/imports/CrmImportFlow.vue:161', 'ربط أعمدة الملف بالبيانات، والمصدر، والمسؤول عند التوزيع عند الاستيراد.'),
  args: {
    columns, profiles: [], sources, agentMode: 'none', packageLabel: 'باقة',
    mapping: { name: 'الاسم', phone: 'الهاتف' }, profileId: null, sourceId: undefined, agentId: null, saveProfile: false, profileName: '',
  },
} satisfies Meta<typeof CrmImportMappingStep>
export default meta
type Story = StoryObj<typeof meta>
export const Filled: Story = {}
export const SavedMapping: Story = { args: { profiles, profileId: 1, mapping: { name: 'الاسم', phone: 'الهاتف', email: 'البريد' } } }
export const AgentRequired: Story = { args: { agentMode: 'required' } }
export const SavingTheMapping: Story = { args: { saveProfile: true, profileName: 'ملف المعرض' } }
export const Refused: Story = { args: { error: 'أحد الأعمدة المختارة غير موجود في الملف.' } }
