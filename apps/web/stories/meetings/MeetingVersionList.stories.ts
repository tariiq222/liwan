import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MeetingVersionList from '../../app/components/meetings/MeetingVersionList.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const versions = [
  { id: 31, number: 3, captured_at: '2026-09-09T10:20:00Z', actor: { id: 3, name: 'سارة القحطاني' }, snapshot: null },
  { id: 22, number: 2, captured_at: '2026-09-08T07:45:00Z', actor: { id: 4, name: 'خالد الحربي' }, snapshot: null },
  { id: 11, number: 1, captured_at: '2026-09-07T06:05:00Z', actor: null, snapshot: null },
]

const meta = {
  title: 'Meetings/MeetingVersionList',
  component: MeetingVersionList,
  parameters: { layout: 'fullscreen' },
  args: { versions, loading: false, error: null, total: 3, page: 1, pageSize: 25, selectedId: null },
} satisfies Meta<typeof MeetingVersionList>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { MeetingVersionList, PageContainer },
  setup: () => ({ args }),
  template: '<main class="webvue-shell-main"><PageContainer width="detail"><MeetingVersionList v-bind="args" /></PageContainer></main>',
})

export const Populated: Story = {
  name: 'نسخ المحضر',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:265'),
  render,
}

export const Selected: Story = {
  name: 'نسخة محددة',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:265'),
  args: { selectedId: 22 },
  render,
}

export const Empty: Story = {
  name: 'بلا نسخ',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:265'),
  args: { versions: [], total: 0 },
  render,
}

export const Loading: Story = {
  name: 'جارٍ التحميل',
  parameters: storyContext('apps/web/app/pages/meetings/[id].vue:265'),
  args: { versions: [], total: 0, loading: true },
  render,
}
