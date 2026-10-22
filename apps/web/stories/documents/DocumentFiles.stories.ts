import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentFiles from '../../app/components/documents/DocumentFiles.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, files, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentFiles', component: DocumentFiles,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { document, files, pending: false },
} satisfies Meta<typeof DocumentFiles>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/documents/[documentId].vue:87'),
  render: args => ({ components: { DocumentFiles, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="form"><DocumentFiles v-bind="args" /></PageContainer></main>' }),
}

export const Reader: Story = { ...Default, args: { document: { ...document, allowed_actions: { update: false, archive: false, restore: false, upload_file: false, manage_access: false } }, files: [ { ...files[0]!, allowed_actions: { archive: false, restore: false, lock: false, unlock: false } } ] } }
export const Uploading: Story = { ...Default, args: { pending: true } }
export const Locked: Story = { ...Default, args: { document, files: [{ ...files[0]!, is_locked: true, is_lock_editor: true, allowed_actions: { archive: true, restore: false, lock: false, unlock: true } }] } }

export const Empty: Story = { ...Default, args: { document: { ...document, file_count: 0 }, files: [] } }
export const EmptyReader: Story = { ...Empty, args: { files: [], document: { ...document, file_count: 0, allowed_actions: { update: false, archive: false, restore: false, upload_file: false, manage_access: false } } } }

export const Personal: Story = { ...Default, args: { readonly: true }, parameters: storyContext('apps/web/app/pages/documents/self/[documentId].vue:37') }
