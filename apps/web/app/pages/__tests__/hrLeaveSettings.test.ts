import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useHrPayrollSettings, useHrPayrollStructures, useHrGosiRates } from '../../composables/useHrPayrollSettings'
import { useHrBankProfiles } from '../../composables/useHrPayrollFiles'
import { useHrEosCases } from '../../composables/useHrPayrollEos'
import { useHrPayrollFinanceSettings } from '../../composables/useHrPayrollFinance'
import { useHrLeaveTypes } from '../../composables/useHrLeave'
import { usePayrollConflict } from '../../composables/usePayrollConflict'
const queries = vi.hoisted(() => ({ options: [] as any[] }))
vi.mock('@tanstack/vue-query', () => ({useQuery:(options:any)=>{queries.options.push(options);return {data:Vue.ref(undefined),error:Vue.ref(null),isLoading:Vue.ref(false),refetch:vi.fn()}},useMutation:()=>({mutateAsync:vi.fn()}),useQueryClient:()=>({})}))
vi.mock('../../composables/useHrOwnIdentity', () => ({useHrOwnIdentity:()=>({ready:Vue.ref(true),scope:Vue.ref({userId:7,companyId:3})})}))

describe('leave settings permission isolation',()=>{
  it('opens the config-only part without enabling employee, leave catalog, balance or payroll reads',()=>{
    const can=(key:string)=>key==='hr.leave.config'
    const request=vi.fn()
    vi.stubGlobal('useAccess',()=>({can}));vi.stubGlobal('useApi',()=>({$api:request}))
    queries.options=[]
    const filename=resolve(import.meta.dirname,'../settings/apps/hr/index.vue')
    const descriptor=parse(readFileSync(filename,'utf8'),{filename}).descriptor
    const code=compileScript(descriptor,{id:'leave-settings-page'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
    const idle=()=>({data:Vue.ref(undefined),error:Vue.ref(null),isLoading:Vue.ref(false),refetch:vi.fn()})
    let enabled:any
    const bindings={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,
      LeaveSettingsForm:{},LeaveApprovalCard:{},ShiftSettingsForm:{},EosCaseMapTable:{},PayrollCostCenterTable:{},PayrollFinanceSettingsForm:{},BankProfileForm:{},BranchStrictCard:{},GosiRateTable:{},PayrollGeneralSettingsForm:{},
      useI18n:()=>({t:String}),useAccess:()=>({can}),useSettingsPage:()=>({parts:Vue.ref([{id:'leave'}]),shows:(id:string)=>id==='leave'}),
      useHrLeaveSettings:(value:any)=>{enabled=value;return idle()},useHrShiftSettings:idle,useHrLeaveApprovalProcess:idle,
      useHrPayrollSettings,useHrPayrollStructures,useHrGosiRates,useHrBankProfiles,useHrEosCases,useHrPayrollFinanceSettings,useHrLeaveTypes,
      useHrPayrollFinanceLookups:()=>({accounts:idle(),journals:idle(),analyticAccounts:idle()}),useHrPayrollCostCenters:idle,
      useSetHrPayrollCostCenter:()=>({mutateAsync:vi.fn()}),useSaveHrEosCase:()=>({mutateAsync:vi.fn()}),
      ApiError:Error,isTruncated:()=>false,saveErrorMessage:String,usePayrollConflict,isPayrollConflict:()=>false,
    }
    const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
    const component=new Function(...Object.keys(bindings),js)(...Object.values(bindings))
    component.setup({}, {expose:()=>{}})
    expect(Vue.toValue(enabled)).toBe(true)
    expect(queries.options.length).toBeGreaterThan(4)
    for(const query of queries.options) expect(Vue.toValue(query.enabled)).toBe(false)
    expect(request).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
