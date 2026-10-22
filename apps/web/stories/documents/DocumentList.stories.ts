import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentList from '../../app/components/documents/DocumentList.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, access, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentList', component: DocumentList,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { documents: [document], returnTo: '/documents?q=سياسة' },
} satisfies Meta<typeof DocumentList>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/documents.vue:241'),
  render: args => ({ components: { DocumentList, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="form"><DocumentList v-bind="args" /></PageContainer></main>' }),
}

export const Personal: Story = { ...Default, args: { recordBase: '/account/documents', returnTo: '/account/documents?offset=25' }, parameters: storyContext('apps/web/app/pages/documents/self/index.vue:38') }
