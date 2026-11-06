import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { optionalProjectTools } from '../../../../utils/projectTools'
import { saveErrorMessage } from '../../../../utils/formFeedback'
function load({optional=true,failure=null as unknown,bothOptional=false}={}) {
 const filename=resolve(import.meta.dirname,'../ProjectToolsSettings.vue')
 const script=compileScript(parse(readFileSync(filename,'utf8'),{filename}).descriptor,{id:'tools'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
 const mutate=vi.fn(async(input:any)=>{if(failure)throw failure;return {...props.project,updated_at:'v3',tools:{...props.project.tools,planning:{...props.project.tools.planning,enabled:input.patch.tool_preferences.planning ?? props.project.tools.planning.enabled}}}});const refetch=vi.fn(async()=>({data:props.project}))
 const bindings={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,optionalProjectTools,saveErrorMessage,useHydrated:()=>Vue.ref(true),useI18n:()=>({t:(k:string)=>k}),useUpdateProject:()=>({mutateAsync:mutate,isPending:Vue.ref(false)}),useProject:()=>({refetch}),ApiError:Error}
 const component=new Function(...Object.keys(bindings),ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText)(...Object.values(bindings))
 const project={id:3,active:true,can_manage:true,updated_at:'v1',tools:{planning:{policy:optional?'optional':'enabled',enabled:false,can_toggle:true},governance:{policy:'enabled',enabled:true,can_toggle:false},finance:{policy:bothOptional?'optional':'disabled',enabled:false,can_toggle:bothOptional}}}
 const props=Vue.reactive({project});const scope=Vue.effectScope();const state=scope.run(()=>component.setup(props,{emit:()=>{},expose:()=>{}}));return {state,mutate,refetch,props,setFailure:(value:unknown)=>{failure=value},stop:()=>scope.stop()}
}
describe('project optional tool settings',()=>{
 it('shows no card when no tools are optional',()=>{const v=load({optional:false});expect(v.state.optional.value).toEqual([]);v.stop()})
 it('starts with a pristine draft',()=>{const v=load();expect(v.state.dirty.value).toBe(false);v.stop()})
 it('sends only an optional preference with the concurrency token',async()=>{const v=load();v.state.preferences.value.planning=true;await v.state.save();expect(v.mutate).toHaveBeenCalledExactlyOnceWith({id:3,patch:{tool_preferences:{planning:true},expected_updated_at:'v1'}});v.stop()})
 it('retains the draft and refreshes policy on refusal',async()=>{const v=load({failure:new Error('changed')});v.state.preferences.value.planning=true;await v.state.save();expect(v.state.preferences.value.planning).toBe(true);expect(v.refetch).toHaveBeenCalledOnce();v.stop()})
 it('does not overwrite another session and requires explicit reload before a changed-only save',async()=>{
  const v=load({bothOptional:true});v.state.preferences.value.planning=true
  v.props.project={...v.props.project,updated_at:'v2',tools:{...v.props.project.tools,finance:{...v.props.project.tools.finance,enabled:true}}}
  await Vue.nextTick();await v.state.save()
  expect(v.mutate).not.toHaveBeenCalled();expect(v.state.conflict.value).toBe(true);expect(v.state.preferences.value.planning).toBe(true)
  await v.state.reload();v.state.preferences.value.planning=true;await v.state.save()
  expect(v.mutate).toHaveBeenCalledExactlyOnceWith({id:3,patch:{tool_preferences:{planning:true},expected_updated_at:'v2'}})
  v.stop()
 })
 it('preserves a stale draft until explicit revert adopts the current version',async()=>{
  const v=load({failure:new Error('stale')});v.state.preferences.value.planning=true;await v.state.save()
  v.props.project={...v.props.project,updated_at:'v2'};await Vue.nextTick();expect(v.state.preferences.value.planning).toBe(true)
  v.setFailure(null);v.state.reset();expect(v.state.dirty.value).toBe(false);v.state.preferences.value.planning=true;await v.state.save()
  expect(v.mutate.mock.calls[1]).toEqual([{id:3,patch:{tool_preferences:{planning:true},expected_updated_at:'v2'}}]);v.stop()
 })

})
