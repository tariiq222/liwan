import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import FileField from '@liwan/ui/app/components/shared/form/FileField.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/FileField',
  component: FileField,
  args: { disabled: false },
} satisfies Meta<typeof FileField>
export default meta
type Story = StoryObj<typeof meta>

export const InMeetingAttachments: Story = {
  name: 'داخل مرفقات الاجتماع',
  parameters: storyContext('apps/web/app/components/shared/data/AttachmentList.vue:99'),
  render: args => ({
    components: { FileField },
    setup: () => ({ args, t: useI18n().t }),
    template: `<div class="grid min-w-0 gap-(--liwan-gap-card) mt-4 border-t border-default pt-4"><label for="meeting-attachment-upload" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.uploadAttachment') }}</label><FileField id="meeting-attachment-upload" class="w-full" :disabled="args.disabled" /><p class="text-xs text-muted">{{ t('meetingsUi.attachmentHelp') }}</p></div>`,
  }),
}

export const InDocumentCard: Story = {
  name: 'رفع فوري من ترويسة المستند',
  parameters: storyContext('apps/web/app/components/documents/DocumentFiles.vue:31', 'زر رفع مباشر بلا اسم ملف معلّق؛ يحافظ الحقل في النماذج على الاختيار التقليدي افتراضيًا.'),
  render: args => ({
    components: { FileField },
    setup: () => ({ args, t: useI18n().t }),
    template: `<UFormField name="document-upload"><FileField id="document-upload" :label="t('documents.upload')" :aria-label="t('documents.upload')" :show-file-name="false" :disabled="args.disabled" /></UFormField>`,
  }),
}

export const Disabled: Story = { ...InMeetingAttachments, name: 'معطّل', args: { disabled: true } }
