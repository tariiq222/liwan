import type { Meta, StoryObj } from '@storybook/vue3-vite'
import InsuranceProvidersCard from '../../../app/components/hr/insurance/InsuranceProvidersCard.vue'
import { storyContext } from '../../support/context'
import { providersFixture } from './fixtures'

const meta = {
  title: 'HR/Insurance/InsuranceProvidersCard',
  component: InsuranceProvidersCard,
  parameters: storyContext('apps/web/app/pages/settings/apps/hr/index.vue:228', 'مزوّدو التأمين في إعدادات الموارد البشرية وقسم المزوّدين في صفحة التأمين: إعادة تسمية وأرشفة واستعادة وإضافة مزوّد.'),
  args: { providers: providersFixture, canEdit: true, reloadProviders: async () => undefined },
} satisfies Meta<typeof InsuranceProvidersCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { name: 'بلا مزوّدين', args: { providers: [] } }
export const ReadOnly: Story = { args: { canEdit: false } }
