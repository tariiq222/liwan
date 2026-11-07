import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectToolsSettings from '../../app/components/pmo/projects/ProjectToolsSettings.vue'
import { projectDetail } from '../fixtures/pmo'
import { storyContext } from '../support/context'
const meta = {title:'Project/ProjectToolsSettings',component:ProjectToolsSettings,parameters:storyContext('apps/web/app/components/pmo/projects/ProjectSettingsForm.vue:98'),args:{project:projectDetail}} satisfies Meta<typeof ProjectToolsSettings>
export default meta
export const Optional: StoryObj<typeof meta> = {args:{project:{...projectDetail,tools:{planning:{policy:'optional',enabled:false,can_toggle:true},governance:{policy:'enabled',enabled:true,can_toggle:false},finance:{policy:'disabled',enabled:false,can_toggle:false}}}}}
export const CompanyManaged: StoryObj<typeof meta> = {args:{project:{...projectDetail,tools:{planning:{policy:'enabled',enabled:true,can_toggle:false},governance:{policy:'enabled',enabled:true,can_toggle:false},finance:{policy:'disabled',enabled:false,can_toggle:false}}}}}
