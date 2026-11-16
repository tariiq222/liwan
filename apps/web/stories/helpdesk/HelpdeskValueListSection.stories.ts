import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HelpdeskValueListSection from '../../app/components/helpdesk/settings/HelpdeskValueListSection.vue'
import { storyContext } from '../support/context'
import { categoryRows, channelRows, tagRows, typeRows } from './helpdeskFixtures'

// One save route per kind, each answering a whole row of that kind (`parent_id` on a category only).
const saveKind = (kind: string, rows: { id: number, name: string, active: boolean, sequence: number }[]) =>
  http.post(`/api/v1/helpdesk/settings/${kind}`, async ({ request }) => {
    const body = await request.json() as { id?: number, name: string, parent_id?: number | false }
    const saved = rows.find(row => row.id === body.id)
    return HttpResponse.json({
      ...(saved ?? { id: 90, active: true, sequence: 90 }),
      ...body,
      ...(kind === 'categories' ? { parent_id: typeof body.parent_id === 'number' ? body.parent_id : null } : {}),
    })
  })
const saves = [saveKind('categories', categoryRows), saveKind('tags', tagRows), saveKind('channels', channelRows), saveKind('types', typeRows)]

const meta = {
  title: 'Helpdesk/HelpdeskValueListSection',
  component: HelpdeskValueListSection,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/apps/helpdesk/index.vue:152', 'قائمة قيم من إعدادات الدعم (التصنيفات بأبيها، والوسوم، والقنوات، وأنواع الطلبات): إعادة تسمية في مكانها، وأرشفة، وإضافة صف.'),
    msw: { handlers: { api: saves } },
  },
  args: { kind: 'categories', rows: categoryRows, canEdit: true },
} satisfies Meta<typeof HelpdeskValueListSection>
export default meta
type Story = StoryObj<typeof meta>

export const Categories: Story = { name: 'تصنيفات بأبيها' }
export const Tags: Story = { name: 'وسوم', args: { kind: 'tags', rows: tagRows } }
export const Channels: Story = { name: 'قنوات', args: { kind: 'channels', rows: channelRows } }
export const Types: Story = { name: 'أنواع الطلبات', args: { kind: 'types', rows: typeRows } }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canEdit: false } }
export const Empty: Story = { name: 'لا قيم', args: { rows: [] } }
