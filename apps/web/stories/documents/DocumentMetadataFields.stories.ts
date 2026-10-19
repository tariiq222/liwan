import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentMetadataFields from '../../app/components/documents/DocumentMetadataFields.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, access, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentMetadataFields', component: DocumentMetadataFields,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { expiry: '2027-10-19', context: { kind: 'hr.department', id: 1 }, tags: [1] },
} satisfies Meta<typeof DocumentMetadataFields>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/components/documents/DocumentCreateForm.vue:33'),
  render: args => ({ components: { DocumentMetadataFields, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="form"><DocumentMetadataFields v-bind="args" /></PageContainer></main>' }),
}
