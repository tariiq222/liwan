import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import CustomerFieldsCard from '../../app/components/customers/settings/CustomerFieldsCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { settings } from './customerFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['customers.settings.manage'] }))
const save = http.patch('/api/v1/customers/settings', async ({ request }) => HttpResponse.json({ ...settings, ...await request.json() as object, revision: 4 }))
const refuseRemoval = { parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/customers/settings', () => HttpResponse.json({ code: 'custom_field_values_exist', message: 'values exist', details: { fields: [{ key: 'city', label: 'المدينة', count: 12 }], options: [] } }, { status: 409 }))] } } } }

const meta = {
  title: 'Customers/CustomerFieldsCard',
  component: CustomerFieldsCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/customers/index.vue:34', 'بطاقة حقول العملاء: يعرّف المسؤول حقول شركته على محرر الحقول المخصصة المشترك. حذف حقل أو خيار يحمله عملاء يسأل أولًا بعدد القيم عند كل حقل وخيار.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { settings, canEdit: true, reloadSettings: async () => ({ ...settings, revision: 4 }) },
} satisfies Meta<typeof CustomerFieldsCard>
export default meta
type Story = StoryObj<typeof meta>

export const Defined: Story = { name: 'حقول معرّفة' }
export const NoFields: Story = { name: 'بلا حقول', args: { settings: { ...settings, fields: [] } } }
export const ViewOnly: Story = { name: 'للعرض فقط', args: { canEdit: false } }
export const RemovalNeedsConfirmation: Story = { name: 'حذف حقل له قيم', ...refuseRemoval }
