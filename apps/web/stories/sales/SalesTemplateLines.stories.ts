import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesTemplateLines from '../../app/components/sales/SalesTemplateLines.vue'
import { storyContext } from '../support/context'
import { brokenTemplate, readyTemplate } from './salesTemplateFixtures'

const meta = {
  title: 'Sales/SalesTemplateLines',
  component: SalesTemplateLines,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/settings/apps/sales/templates/[id]/index.vue:82', 'بنود قالب عرض السعر للقراءة: قسم وملاحظة ومنتجات بكمياتها، وعلامة على المنتج الذي لم يعد متاحًا.') },
  args: { lines: readyTemplate.lines },
} satisfies Meta<typeof SalesTemplateLines>
export default meta
type Story = StoryObj<typeof meta>

export const Lines: Story = { name: 'بنود' }
export const UnavailableProduct: Story = { name: 'منتج غير متاح', args: { lines: brokenTemplate.lines } }
export const Empty: Story = { name: 'بلا بنود', args: { lines: [] } }
