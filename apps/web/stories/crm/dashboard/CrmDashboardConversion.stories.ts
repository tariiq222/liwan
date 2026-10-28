import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmDashboardConversion from '../../../app/components/crm/dashboard/CrmDashboardConversion.vue'
import { storyContext } from '../../support/context'
import { sourcesBlock } from './crmDashboardFixtures'

const meta = {
  title: 'CRM/CrmDashboardConversion',
  component: CrmDashboardConversion,
  parameters: storyContext('apps/web/app/pages/crm/index.vue:34', 'التحويل حسب المصدر: المباع من الإجمالي بشريط ونسبة.'),
  args: { sources: sourcesBlock },
} satisfies Meta<typeof CrmDashboardConversion>
export default meta
type Story = StoryObj<typeof meta>
export const BySource: Story = {}
export const Empty: Story = { args: { sources: [] } }
