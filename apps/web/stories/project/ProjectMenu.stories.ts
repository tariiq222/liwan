import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectMenu from '../../app/components/pmo/projects/ProjectMenu.vue'
import { archivedProject, project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectMenu',
  component: ProjectMenu,
  args: { project, hideSettings: true },
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectCardBody.vue:48', 'تذييل بطاقة المشروع. الأرشفة تعرض تأكيدًا ثم خطأ 422 لأن Storybook لا يحاكي تفاصيل المشروع الكاملة.'),
  render: args => ({
    components: { ProjectMenu },
    setup: () => ({ args }),
    template: `<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><article class="flex flex-col gap-4 rounded-lg ring ring-default bg-default overflow-hidden p-5"><p class="font-semibold text-highlighted">{{ args.project.name }}</p><div class="mt-auto flex items-center justify-between gap-3 border-t border-default pt-3 text-xs text-muted"><span class="truncate">{{ args.project.manager?.name ?? '—' }}</span><span class="inline-flex shrink-0 items-center gap-2"><span>{{ args.project.date_end ?? '—' }}</span><ProjectMenu v-bind="args" /></span></div></article></div>`,
  }),
} satisfies Meta<typeof ProjectMenu>
export default meta
type Story = StoryObj<typeof meta>

export const OnProjectCard: Story = { name: 'على بطاقة المشروع' }
export const Archived: Story = { name: 'مشروع مؤرشف', args: { project: archivedProject } }
