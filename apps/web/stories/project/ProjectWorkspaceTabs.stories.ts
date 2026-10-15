import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import ProjectWorkspaceTabs from '../../app/components/pmo/projects/workspace/ProjectWorkspaceTabs.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectWorkspaceTabs',
  component: ProjectWorkspaceTabs,
  args: { projectId: 1, active: true },
  parameters: storyContext('apps/web/app/pages/projects/[id].vue:114', 'شريط أقسام المشروع: خط سفلي مستقيم للقسم الحالي وزوايا غير منحنية.'),
  render: args => ({
    components: { ProjectWorkspaceTabs },
    setup: () => {
      const router = useRouter()
      onMounted(() => router.push('/projects/1/governance'))
      return { args }
    },
    template: '<ProjectWorkspaceTabs v-bind="args" />',
  }),
} satisfies Meta<typeof ProjectWorkspaceTabs>
export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = { name: 'مشروع نشط' }
export const Archived: Story = { name: 'مشروع مؤرشف', args: { active: false } }

export const Governance: Story = {
  name: 'تبويبات الحوكمة الفرعية',
  render: args => ({
    components: { ProjectWorkspaceTabs },
    setup: () => {
      const router = useRouter()
      onMounted(() => router.push('/projects/1/stakeholders'))
      return { args }
    },
    template: '<div class="flex flex-col"><ProjectWorkspaceTabs :project-id="args.projectId" :active="true" /><ProjectWorkspaceTabs :project-id="args.projectId" level="governance" /></div>',
  }),
}
