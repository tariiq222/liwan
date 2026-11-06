import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CreatePanel from '@liwan/ui/app/components/shared/layout/CreatePanel.vue'
import { useI18n } from 'vue-i18n'
import ProjectCreateForm from '../../app/components/pmo/projects/ProjectCreateForm.vue'
import { storyContext } from '../support/context'
const meta = { title: 'Project/ProjectCreateForm', component: ProjectCreateForm, parameters: {layout:'fullscreen',...storyContext('apps/web/app/pages/projects/new.vue:76')}, render: args => ({components:{CreatePanel,ProjectCreateForm},setup:()=>({args,t:useI18n().t}),template:`<CreatePanel :title="t('projects.new')" back-to="/projects"><ProjectCreateForm v-bind="args" /></CreatePanel>`}) } satisfies Meta<typeof ProjectCreateForm>
export default meta
export const Simple: StoryObj<typeof meta> = {}
