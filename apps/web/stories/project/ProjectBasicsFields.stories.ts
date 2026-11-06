import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectBasicsFields from '../../app/components/pmo/projects/ProjectBasicsFields.vue'
import { storyContext } from '../support/context'
const meta = {title:'Project/ProjectBasicsFields',component:ProjectBasicsFields,parameters:storyContext('apps/web/app/components/pmo/projects/ProjectCreateForm.vue:75'),args:{modelValue:{name:'بوابة خدمات العملاء',description:'استقبال الطلبات ومتابعة إنجازها.',objectives:[{goal:'إطلاق البوابة',metric:'عدد الطلبات',target:'٢٠ طلبًا خلال شهر'},{goal:'تقليل وقت الانتظار',metric:'',target:''}],success_criteria:'٢٠ طلبًا خلال الشهر الأول.',user_id:null,date_start:null,date_end:null}}} satisfies Meta<typeof ProjectBasicsFields>
export default meta
export const Basic: StoryObj<typeof meta> = {}
export const RequiredDate: StoryObj<typeof meta> = {args:{requireEndDate:true}}
export const PrefilledDates: StoryObj<typeof meta> = {args:{modelValue:{...meta.args.modelValue,date_start:'2030-02-01',date_end:'2030-03-01'}}}
