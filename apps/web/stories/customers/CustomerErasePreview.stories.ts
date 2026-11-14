import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CustomerErasePreview from '../../app/components/customers/CustomerErasePreview.vue'
import { storyContext } from '../support/context'

const item = (key: string, action: 'erase' | 'retain' | 'unhandled', count: number, owner = 'liwan_customers', complete = true) => ({ key, owner, action, count, complete })
const preview = {
  customer: { id: 41, erased: false },
  items: [
    item('customer', 'erase', 2), item('bank_accounts', 'erase', 1), item('crm_leads', 'erase', 4, 'liwan_crm'), item('inbox_messages', 'erase', 38, 'liwan_inbox'),
    item('finance_documents', 'retain', 6, 'liwan_finance'), item('inbox_consent', 'retain', 1, 'liwan_inbox'),
  ],
  incomplete: [],
  empty_models: [],
  not_covered: ['chatter_history', 'free_text_notes', 'stored_documents', 'backups', 'accounting_name_copies'],
  reach: { shared: false, covers_all: true },
  token: 'token',
  expires_in: 600,
}

const meta = {
  title: 'Customers/CustomerErasePreview',
  component: CustomerErasePreview,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/customers/[id]/privacy.vue:112', 'مراجعة المسح بلغة بسيطة: ما سيُمسح مع أعداده، وما يبقى بحكم القانون وسببه، وما لا يغيّره المسح. وحين يمنع شيء المسح يذكر لكل عنصر سببه والإجراء المطلوب.'),
  },
  args: { preview },
} satisfies Meta<typeof CustomerErasePreview>
export default meta
type Story = StoryObj<typeof meta>

export const CanRun: Story = { name: 'يمكن المسح' }
export const NoCoverage: Story = {
  name: 'الجلسة لا تغطي كل الفروع',
  args: {
    preview: {
      ...preview,
      incomplete: [{ key: 'crm_leads', owner: 'liwan_crm', reason: 'session_does_not_cover_every_company' }, { key: 'inbox_messages', owner: 'liwan_inbox', reason: 'session_does_not_cover_every_company' }],
      reach: { shared: true, covers_all: false },
    },
  },
}
export const CannotReach: Story = {
  name: 'سجلات لا يصل إليها المستخدم',
  args: { preview: { ...preview, items: preview.items.map(entry => entry.key === 'crm_leads' ? { ...entry, complete: false } : entry), incomplete: [{ key: 'crm_leads', owner: 'liwan_crm', reason: 'caller_cannot_reach_all_records' }] } },
}
export const NoHook: Story = {
  name: 'تطبيق لا يدعم المسح',
  args: {
    preview: {
      ...preview,
      items: [...preview.items, item('sale.order', 'unhandled', 3, 'sale', false)],
      incomplete: [{ key: 'sale.order', owner: 'sale', reason: 'application_has_no_hook' }],
    },
  },
}
export const UnknownKeys: Story = {
  name: 'مفاتيح وأسباب غير معروفة',
  args: {
    preview: {
      ...preview,
      items: [item('future_thing', 'erase', 2, 'liwan_future'), item('future_kept', 'retain', 1, 'liwan_future')],
      incomplete: [{ key: 'future_thing', owner: 'liwan_future', reason: 'a_new_reason' }],
      not_covered: ['a_future_key'],
    },
  },
}
export const Empty: Story = { name: 'لا بيانات مرتبطة', args: { preview: { ...preview, items: [], not_covered: [] } } }
