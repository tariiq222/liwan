import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
class ApiError extends Error { constructor(public status: number) { super('failure') } }
function load(save = vi.fn(), revision = 0, reloadSettings = vi.fn()) {
  const filename = resolve(import.meta.dirname, '../LeaveSettingsForm.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = compileScript(descriptor, { id: 'leave-settings' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const props = Vue.reactive({settings:{cancellation_policy:'manager_approval',revision},canEdit:true,reloadSettings})
  const emit = vi.fn()
  const bindings = {_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,useI18n:()=>({t:(key:string)=>key}),useHydrated:()=>Vue.ref(true),useSaveHrLeaveSettings:()=>({mutateAsync:save,isPending:Vue.ref(false)}),ApiError,saveErrorMessage:()=> 'failure'}
  const js = ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
  const component = new Function(...Object.keys(bindings),js)(...Object.values(bindings))
  const state = component.setup(props,{expose:()=>{},emit})
  return {state,props,emit,save}
}
describe('leave policy draft',()=>{
  it('offers all three policies and saves the unsaved default revision 0',async()=>{
    const save=vi.fn().mockResolvedValue({cancellation_policy:'manager_only',revision:1})
    const {state}=load(save)
    expect(state.items.value.map((item:any)=>item.value)).toEqual(['manager_approval','direct_employee','manager_only'])
    state.policy.value='manager_only'
    await state.submit()
    expect(save).toHaveBeenCalledWith({cancellation_policy:'manager_only',revision:0})
    expect(state.dirty.value).toBe(false)
  })
  it('keeps the draft and conflict while an explicit reload is still pending',async()=>{
    let resolveReload:(value:unknown)=>void=()=>{}
    const refresh=()=>new Promise(resolve=>{resolveReload=resolve})
    const {state}=load(vi.fn().mockRejectedValue(new ApiError(409)),3,refresh as any)
    state.policy.value='direct_employee'
    await state.submit()
    const waiting=state.reload()
    expect(state.reloading.value).toBe(true)
    expect(state.policy.value).toBe('direct_employee')
    expect(state.conflict.value).toBe(true)
    resolveReload({cancellation_policy:'manager_only',revision:4})
    await waiting
    expect(state.conflict.value).toBe(false)
    expect(state.policy.value).toBe('manager_only')
  })
  it('retains the draft on failure and requires an explicit reload after a conflict',async()=>{
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({cancellation_policy:'manager_only',revision:4})
    const {state,props}=load(vi.fn().mockRejectedValue(new ApiError(409)),3,refresh)
    state.policy.value='direct_employee'
    await state.submit()
    expect(state.policy.value).toBe('direct_employee')
    expect(state.baseline.value.revision).toBe(3)
    expect(state.conflict.value).toBe(true)
    props.settings={cancellation_policy:'manager_only',revision:4}
    await Vue.nextTick()
    expect(state.baseline.value.revision).toBe(3)
    await state.reload()
    expect(state.conflict.value).toBe(true)
    expect(state.policy.value).toBe('direct_employee')
    await state.reload()
    expect(state.policy.value).toBe('manager_only')
    expect(state.baseline.value.revision).toBe(4)
    expect(state.conflict.value).toBe(false)
  })
})
