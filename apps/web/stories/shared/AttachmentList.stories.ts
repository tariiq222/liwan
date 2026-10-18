import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import AttachmentList from '../../app/components/shared/data/AttachmentList.vue'
import { storyContext } from '../support/context'

const labels = {
  empty: 'لا مرفقات بعد',
  upload: 'رفع ملف',
  help: 'PDF أو PNG أو JPEG أو نص أو DOCX أو XLSX، بحد أقصى 10 ميغابايت',
  delete: 'حذف المرفق',
  deleteConfirm: 'حذف هذا المرفق؟',
  confirm: 'تأكيد الحذف',
  keep: 'إلغاء',
}
const attachments = [
  { id: 1, name: 'عرض-المشروع.pdf', url: '#' },
  { id: 2, name: 'جدول-الميزانية.xlsx', url: '#' },
]

// The list runs no request: `uploadFile` and `deleteFile` are the app's async handlers.
const meta = {
  title: 'Shared/AttachmentList',
  component: AttachmentList,
  parameters: storyContext('apps/web/app/components/personal-tasks/MyTaskAttachments.vue:6', 'قائمة مرفقات سجل مع حذف بتأكيد مضمّن وحقل رفع واحد؛ يستخدمها تطبيقا المهام (المشاريع والمهام الشخصية). المعالجان `uploadFile` و`deleteFile` يمرّرهما التطبيق ويبلّغ عن فشلهما عبر `error`.'),
  args: { attachments, labels, canWrite: true, uploadFile: fn(async () => {}), deleteFile: fn(async () => {}), uploadId: 'story-attachment-upload' },
  render: args => ({
    components: { AttachmentList },
    setup: () => ({ args }),
    template: '<div class="max-w-xl"><AttachmentList v-bind="args" /></div>',
  }),
} satisfies Meta<typeof AttachmentList>
export default meta
type Story = StoryObj<typeof meta>

export const Writable: Story = { name: 'قابل للتعديل' }
export const ReadOnly: Story = { name: 'للقراءة فقط', args: { canWrite: false } }
export const Empty: Story = { name: 'بلا مرفقات', args: { attachments: [] } }
export const Loading: Story = { name: 'قيد التحميل', args: { attachments: [], loading: true } }
export const WithError: Story = { name: 'خطأ من الرفع', args: { error: 'نوع الملف غير مسموح' } }
