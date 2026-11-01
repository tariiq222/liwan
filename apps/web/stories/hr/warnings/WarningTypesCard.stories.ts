import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WarningTypesCard from '../../../app/components/hr/warnings/WarningTypesCard.vue'
import { storyContext } from '../../support/context'
import { warningTypesFixture } from './fixtures'

const meta = {
  title: 'HR/Warnings/WarningTypesCard',
  component: WarningTypesCard,
  parameters: storyContext('apps/web/app/pages/settings/apps/hr/index.vue:205', 'أنواع الإنذارات في إعدادات الموارد البشرية: إعادة تسمية وتغيير الخطورة وأرشفة واستعادة وإضافة نوع.'),
  args: { types: warningTypesFixture, canEdit: true, reloadTypes: async () => undefined },
} satisfies Meta<typeof WarningTypesCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { name: 'بلا أنواع', args: { types: [] } }
export const ReadOnly: Story = { args: { canEdit: false } }
