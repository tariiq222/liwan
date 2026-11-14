import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { CustomerCreditNote, CustomerInvoice } from '@liwan/commercial-contracts'
import InvoiceDocument from '../../app/components/subscription/InvoiceDocument.vue'
import { invoice } from './fixtures'
import { storyContext } from '../support/context'

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const seller = { legal_name_ar: 'شركة ليوان المحدودة', legal_name_en: 'Liwan Co.', commercial_registration: '1010000000', address: 'طريق العليا\nبرج 4', city: 'الرياض', country: 'السعودية', email: 'billing@liwan.example', phone: '+966110000000' }
const note = (status: CustomerCreditNote['status'], amount: number): CustomerCreditNote => ({ id: 'n1', amount: sar(amount), cause: 'vendor_refund', status, created_at: '2026-10-05T08:00:00Z', refunded_at: status === 'refunded' ? '2026-10-06T08:00:00Z' : null, refund_reference: status === 'refunded' ? 'BANK-4471' : null })
const base: CustomerInvoice = { ...invoice, customer_name: 'شركة المثال للتجارة', seller, credit_notes: [] }

const meta = {
  title: 'Subscription/InvoiceDocument',
  component: InvoiceDocument,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/subscription/invoices/print/[id].vue:24') },
  args: { invoice: base },
} satisfies Meta<typeof InvoiceDocument>
export default meta

type Story = StoryObj<typeof meta>
export const Issued: Story = {}
export const Paid: Story = { args: { invoice: { ...base, status: 'paid', paid_at: '2026-10-03', due_at: '2026-10-16' } } }
export const PartlyCredited: Story = { args: { invoice: { ...base, status: 'paid', credit_notes: [note('refunded', 10000)] } } }
export const Refunded: Story = { args: { invoice: { ...base, status: 'credit_pending', credit_notes: [note('refunded', 26000)] } } }
export const WithoutSellerIdentity: Story = { args: { invoice: { ...base, seller: null } } }
