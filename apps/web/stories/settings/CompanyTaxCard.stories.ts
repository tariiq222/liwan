import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse, delay } from 'msw'
import type { CompanyTax } from '@liwan/contracts'
import CompanyTaxCard from '../../app/components/settings/CompanyTaxCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'

// One establishment tax choice: not registered, the price includes the tax, or the tax is added to it. The price mode
// locks after the first accounting entry, so the card states it before anything is saved and disables the two price
// modes once `locked`; a branch session reads the choice and says where it is changed.
const tax = (overrides: Partial<CompanyTax> = {}): CompanyTax => ({
  registered: true, price_mode: 'included', choice: 'included', locked: false, can_change: true, is_root_session: true, ...overrides,
})
const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['settings.company.read', 'settings.company.vat.manage'] }))
const save = http.patch('/api/v1/admin/company/tax', async ({ request }) => {
  const body = await request.json() as { registered?: boolean; price_mode?: 'included' | 'added' }
  const registered = body.registered ?? true
  const priceMode = body.price_mode ?? 'included'
  return HttpResponse.json(tax({ registered, price_mode: priceMode, choice: registered ? priceMode : 'none' }))
})
const refuse = (status: number, body: object) => ({ parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/admin/company/tax', () => HttpResponse.json(body, { status }))] } } } })

const meta = {
  title: 'Settings/CompanyTaxCard',
  component: CompanyTaxCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/company/index.vue:53', 'بطاقة ضريبة المنشأة: اختيار واحد لكل الفروع بين «بدون ضريبة» و«السعر شامل الضريبة» و«الضريبة تُضاف إلى السعر»، مع مثال محسوب، وقفل طريقة السعر بعد أول قيد محاسبي، وعرض للقراءة فقط من جلسة فرع أو بلا صلاحية.'),
    msw: { handlers: { api: [manage, save] } },
  },
  args: { tax: tax(), vatNumber: '300000000000003', reloadTax: async () => tax({ locked: true }) },
} satisfies Meta<typeof CompanyTaxCard>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }
export const Locked: Story = { name: 'طريقة السعر مثبّتة', args: { tax: tax({ locked: true }) } }
export const BranchReadOnly: Story = { name: 'للقراءة من فرع', args: { tax: tax({ can_change: false, is_root_session: false }) } }
export const NoPermission: Story = { name: 'بلا صلاحية تغيير', args: { tax: tax({ can_change: false }) } }
export const NotRegistered: Story = { name: 'بدون ضريبة', args: { tax: tax({ registered: false, choice: 'none', price_mode: 'included' }) } }
export const NotRegisteredLocked: Story = { name: 'بدون ضريبة وطريقة السعر مثبّتة', args: { tax: tax({ registered: false, choice: 'none', locked: true }) } }
export const Saving: Story = { name: 'جارٍ الحفظ', parameters: { msw: { handlers: { api: [manage, http.patch('/api/v1/admin/company/tax', async () => { await delay(10_000); return HttpResponse.json(tax()) })] } } } }
export const LockedRefused: Story = { name: 'رفض القفل', ...refuse(409, { code: 'tax_mode_locked', message: 'The price mode cannot change once the establishment has a journal item.' }) }
export const Forbidden: Story = { name: 'ممنوع', ...refuse(403, { code: 'forbidden', message: 'forbidden' }) }
