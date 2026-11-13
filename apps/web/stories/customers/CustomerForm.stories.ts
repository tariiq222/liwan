import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CustomerForm from '../../app/components/customers/CustomerForm.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { customers, settings } from './customerFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['customers.read', 'customers.manage'] }))
const companies = http.get('/api/v1/customers', () => HttpResponse.json({ items: customers.filter(customer => customer.is_company), total: 1 }))
const noCompanies = http.get('/api/v1/customers', () => HttpResponse.json({ items: [], total: 0 }))
const answer = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.post('/api/v1/customers', () => HttpResponse.json(body, { status })), companies] } } } })

const meta = {
  title: 'Customers/CustomerForm',
  component: CustomerForm,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/customers/new.vue:23', 'نموذج إنشاء العميل وتعديله: الاسم والجوال والبريد، وخيار فرد/شركة بحسب أنواع العملاء في الإعدادات، وحقول الشركة المخصصة. عند تطابق الجوال يعرض العملاء المطابقين ليفتح أحدهم أو ينشئ عميلًا جديدًا.'),
    msw: { handlers: { api: [manage, companies] } },
  },
  args: { settings, backTo: '/customers' },
} satisfies Meta<typeof CustomerForm>
export default meta
type Story = StoryObj<typeof meta>

export const New: Story = { name: 'عميل جديد (أفراد وشركات)' }
export const NewIndividualsOnly: Story = { name: 'عميل جديد (أفراد فقط)', args: { settings: { ...settings, party_kinds: 'individuals' } } }
export const NewCompaniesOnly: Story = { name: 'عميل جديد (شركات: شركة أو جهة اتصال تابعة)', args: { settings: { ...settings, party_kinds: 'companies' } } }
export const NewIndividualsWithoutCompanies: Story = {
  name: 'عميل جديد (أفراد، لا توجد شركات)',
  args: { settings: { ...settings, party_kinds: 'individuals' } },
  parameters: { msw: { handlers: { api: [manage, noCompanies] } } },
}
export const NewWithoutFields: Story = { name: 'عميل جديد بلا حقول إضافية', args: { settings: { ...settings, fields: [] } } }
export const Edit: Story = { name: 'تعديل', args: { customer: customers[0] } }
export const EditContactUnderCompany: Story = { name: 'تعديل جهة اتصال تابعة لشركة', args: { customer: customers[2] } }
export const ParentRefused: Story = { name: 'شركة غير صالحة', args: { customer: customers[2] }, parameters: { msw: { handlers: { api: [manage, companies, http.patch('/api/v1/customers/3', () => HttpResponse.json({ code: 'invalid', message: 'the parent must be a company customer', field: 'parent_id' }, { status: 422 }))] } } } }
export const PhoneRefused: Story = { name: 'رقم غير صحيح', ...answer(422, { code: 'invalid_phone', message: 'invalid phone', field: 'phone' }) }
export const SameNumber: Story = {
  name: 'عملاء بالرقم نفسه',
  ...answer(409, { code: 'conflict', message: 'customers share this phone', details: { candidates: [{ id: 41, name: 'منى العتيبي', phone_last4: '0001' }] } }),
}
