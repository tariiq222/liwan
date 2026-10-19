import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentReader from '../../app/components/documents/DocumentReader.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentReader', component: DocumentReader,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { document },
} satisfies Meta<typeof DocumentReader>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/documents/[documentId].vue:84'),
  render: args => ({ components: { DocumentReader, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="form"><DocumentReader v-bind="args" /></PageContainer></main>' }),
}
