import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentCreateForm from '../../app/components/documents/DocumentCreateForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, access, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentCreateForm', component: DocumentCreateForm,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { initialContext: { kind: 'hr.department', id: 1 }, backTo: '/documents?q=سياسة' },
} satisfies Meta<typeof DocumentCreateForm>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/documents/new.vue:15'),
  render: args => ({ components: { DocumentCreateForm, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer width="form"><DocumentCreateForm v-bind="args" /></PageContainer></main>' }),
}
