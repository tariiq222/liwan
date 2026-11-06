import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {compileScript,parse} from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import {describe,expect,it} from 'vitest'
import {renderShared} from '@liwan/ui/test/helpers/renderShared'
function load(){
 const filename=resolve(import.meta.dirname,'../ProjectFieldHelp.vue')
 const script=compileScript(parse(readFileSync(filename,'utf8'),{filename}).descriptor,{id:'field-help'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
 const frames=new Map<number,FrameRequestCallback>();let sequence=0;const cleanup:Array<()=>void>=[]
 const documentRef:{activeElement:unknown}={activeElement:null};const trigger={isConnected:true,ownerDocument:documentRef};documentRef.activeElement=trigger
 const bindings={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,useHydrated:()=>Vue.ref(true),useId:()=> 'help-id',requestAnimationFrame:(fn:FrameRequestCallback)=>{const id=++sequence;frames.set(id,fn);return id},cancelAnimationFrame:(id:number)=>frames.delete(id),onBeforeUnmount:(fn:()=>void)=>cleanup.push(fn)}
 const component=new Function(...Object.keys(bindings),ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText)(...Object.values(bindings))
 const state=component.setup({text:'Help',label:'Explain'},{expose:()=>{}})
 return {state,trigger,documentRef,focus:()=>state.onFocus?.({currentTarget:trigger}),flush:()=>{for(const [id,fn] of [...frames]){frames.delete(id);fn(0)}},unmount:()=>cleanup.forEach(fn=>fn())}
}
describe('field help focus lifecycle',()=>{
 it('keeps focus help open after the browser autoscroll causes the native hover card to dismiss',()=>{
  const v=load();v.focus();v.state.open.value=true;v.state.open.value=false;v.flush();expect(v.state.open.value).toBe(true)
 })
 it('does not reopen after focus has moved away',()=>{const v=load();v.focus();v.documentRef.activeElement=null;v.state.open.value=false;v.flush();expect(v.state.open.value).toBe(false)})
 it.each(['Escape','Enter',' '])('does not override the immediate %s keyboard action',key=>{
  const v=load();v.focus();v.state.open.value=key==='Escape'?false:true;v.state.onKeydown({key,preventDefault:()=>{},stopPropagation:()=>{}});v.flush();expect(v.state.open.value).toBe(false)
 })
 it('does not override a touch close',()=>{const v=load();v.focus();v.state.open.value=true;v.state.onPointerDown({pointerType:'touch',preventDefault:()=>{},stopPropagation:()=>{}});v.flush();expect(v.state.open.value).toBe(false)})
 it('cancels pending focus work on blur and unmount',()=>{for(const operation of ['blur','unmount']){const v=load();v.focus();if(operation==='blur')v.state.onBlur?.();else v.unmount();v.state.open.value=false;v.flush();expect(v.state.open.value).toBe(false)}})
 it.each(['onPointerDownOutside','onEscapeKeyDown'])('cancels queued focus recovery through actual public %s content binding',async eventName=>{
  const frames=new Map<number,FrameRequestCallback>();let sequence=0;let executed=0
  let content:Record<string,()=>void>={};let focus:((event:unknown)=>void)|undefined
  const popover=Vue.defineComponent({props:['content','open'],setup:(props,{slots})=>{content=props.content;return()=>Vue.h('div',slots.default?.())}})
  const button=Vue.defineComponent({inheritAttrs:false,setup:(_, {attrs})=>{focus=attrs.onFocus as (event:unknown)=>void;return()=>Vue.h('button',attrs)}})
  await renderShared(resolve(import.meta.dirname,'../ProjectFieldHelp.vue'),{label:'Explain',text:'Help'},{},{stubs:{UPopover:popover,UButton:button},globals:{requestAnimationFrame:(fn:FrameRequestCallback)=>{const id=++sequence;frames.set(id,fn);return id},cancelAnimationFrame:(id:number)=>frames.delete(id)}})
  const documentRef:{activeElement:unknown}={activeElement:null};const trigger={isConnected:true,ownerDocument:documentRef};documentRef.activeElement=trigger
  focus!({currentTarget:trigger});content[eventName]?.()
  expect(documentRef.activeElement).toBe(trigger)
  for(const [id,fn] of [...frames]){frames.delete(id);executed++;fn(0)}
  expect(executed).toBe(0)
 })

})
