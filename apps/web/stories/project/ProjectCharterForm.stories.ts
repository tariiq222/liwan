import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectCharterForm from '../../app/components/pmo/projects/ProjectCharterForm.vue'
import { projectDetail } from '../fixtures/pmo'
import { storyContext } from '../support/context'
const meta = { title:'Project/ProjectCharterForm',component:ProjectCharterForm,parameters:storyContext('apps/web/app/pages/projects/[id]/charter.vue:63'),args:{project:projectDetail} } satisfies Meta<typeof ProjectCharterForm>
export default meta
export const Edit: StoryObj<typeof meta> = {}
export const ReadOnly: StoryObj<typeof meta> = {args:{readonly:true}}
