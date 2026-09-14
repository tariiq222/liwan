import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import FileField from '../../app/components/shared/FileField.vue'
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
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:621', 'الغلاف `.meeting-upload` مُعرَّف scoped في نفس الملف: grid، min-width: 0، gap: 8px، margin-block-start: 16px، padding-block-start: 16px، border-block-start: 1px solid var(--border).'),
  render: args => ({
    components: { FileField },
    setup: () => ({ args, t: useI18n().t }),
    template: `<div style="display: grid; min-width: 0; gap: 8px; margin-block-start: 16px; padding-block-start: 16px; border-block-start: 1px solid var(--border)"><label for="meeting-attachment-upload" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.uploadAttachment') }}</label><FileField id="meeting-attachment-upload" class="w-full" :disabled="args.disabled" /><p class="text-xs text-muted-foreground">{{ t('meetingsUi.attachmentHelp') }}</p></div>`,
  }),
}

export const InDocumentCard: Story = {
  name: 'داخل بطاقة مرفقات مستند',
  parameters: storyContext('apps/web/app/pages/hr/departments/[departmentId]/documents/[documentId]/edit.vue:96'),
  render: args => ({
    components: { FileField },
    setup: () => ({ args, t: useI18n().t }),
    template: `<UCard class="rounded-lg ring ring-default bg-default overflow-hidden" :ui="{ header: '' }"><template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.docs.attachments') }}</h2></template><div class="space-y-3"><UFormField :label="t('hr.docs.upload')" name="hr-doc-upload"><FileField id="hr-doc-upload" class="w-full" :disabled="args.disabled" /></UFormField></div></UCard>`,
  }),
}

export const Disabled: Story = { ...InMeetingAttachments, name: 'معطّل', args: { disabled: true } }
