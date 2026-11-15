import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesQuoteDocument from '../../app/components/sales/SalesQuoteDocument.vue'
import { storyContext } from '../support/context'
import { publicQuote } from './salesFixtures'

const meta = {
  title: 'Sales/SalesQuoteDocument',
  component: SalesQuoteDocument,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/quote/[id].vue:48', 'عرض السعر كما يقرؤه العميل: بياناته وبنوده وإجمالياته وشروطه.') },
  args: { quote: publicQuote },
} satisfies Meta<typeof SalesQuoteDocument>
export default meta
type Story = StoryObj<typeof meta>

export const Quotation: Story = { name: 'عرض سعر' }
export const WithoutValidityAndTerms: Story = { name: 'بلا صلاحية ولا شروط', args: { quote: { ...publicQuote, validity_date: null, terms: '' } } }
