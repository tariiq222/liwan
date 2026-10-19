import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentEditor from '../../app/components/documents/DocumentEditor.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, access, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentEditor', component: DocumentEditor,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { modelValue: document.body, documentId: document.id, debounce: false },
} satisfies Meta<typeof DocumentEditor>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/components/documents/DocumentCreateForm.vue:35'),
  render: args => ({ components: { DocumentEditor, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="form"><DocumentEditor v-bind="args" /></PageContainer></main>' }),
}
