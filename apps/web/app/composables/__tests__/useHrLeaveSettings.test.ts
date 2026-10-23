import { QueryClient } from '@tanstack/vue-query'
import { ref, toValue } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHrLeaveSettings, useSaveHrLeaveSettings } from '../useHrLeaveSettings'
const mocks=vi.hoisted(()=>({api:vi.fn(),set:vi.fn(),invalidate:vi.fn(),cancel:vi.fn().mockResolvedValue(undefined),client:null as any}))
vi.mock('@tanstack/vue-query',async original=>({...await original<object>(),useQuery:(options:unknown)=>options,useMutation:(options:unknown)=>options,useQueryClient:()=>mocks.client??({setQueryData:mocks.set,invalidateQueries:mocks.invalidate,cancelQueries:mocks.cancel})}))
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();mocks.client=null})
describe('leave settings capability and company scope',()=>{
  function setup(){const capabilities=ref(['hr.leave.config']);vi.stubGlobal('useApi',()=>({$api:mocks.api}));vi.stubGlobal('useMe',()=>({me:ref({id:7,company:{id:3}})}));vi.stubGlobal('useAccess',()=>({can:(key:string)=>capabilities.value.includes(key)}));return capabilities}
  it('needs only config and an enabled part, keyed by company and actor',async()=>{
    const caps=setup();const enabled=ref(true)
    const query=useHrLeaveSettings(enabled) as any
    expect(toValue(query.enabled)).toBe(true)
    expect(toValue(query.queryKey)).toEqual(['hr','leave','settings',{companyId:3,userId:7}])
    await query.queryFn();expect(mocks.api).toHaveBeenCalledWith('/api/v1/hr/leave/settings',expect.anything())
    enabled.value=false;expect(toValue(query.enabled)).toBe(false)
    enabled.value=true;caps.value=[];expect(toValue(query.enabled)).toBe(false)
  })
  it('PATCHes the revision and refreshes effective leave policy after success',async()=>{
    setup();mocks.api.mockResolvedValue({cancellation_policy:'manager_only',revision:2})
    const mutation=useSaveHrLeaveSettings() as any
    await mutation.mutationFn({cancellation_policy:'manager_only',revision:1})
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/hr/leave/settings',expect.objectContaining({method:'PATCH',body:{cancellation_policy:'manager_only',revision:1}}))
    expect(mocks.set).toHaveBeenCalledWith(['hr','leave','settings',{companyId:3,userId:7}],{cancellation_policy:'manager_only',revision:2})
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.objectContaining({queryKey:['hr','leave']}))
  })
  it('cancels an older in-flight settings GET before caching the authoritative PATCH response',async()=>{
    setup()
    const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});mocks.client=qc
    const key=['hr','leave','settings',{companyId:3,userId:7}]
    let oldResponse:(value:unknown)=>void=()=>{}
    const oldGet=qc.fetchQuery({queryKey:key,queryFn:()=>new Promise(resolve=>{oldResponse=resolve})}).catch(()=>{})
    const saved={cancellation_policy:'manager_only',revision:2}
    mocks.api.mockResolvedValue(saved)
    await (useSaveHrLeaveSettings() as any).mutationFn({cancellation_policy:'manager_only',revision:1})
    oldResponse({cancellation_policy:'manager_approval',revision:0})
    await oldGet
    expect(qc.getQueryData(key)).toEqual(saved)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    qc.clear()
  })
  it('does not write a late response into a different identity cache',async()=>{
    setup()
    const me=ref({id:7,company:{id:3}})
    vi.stubGlobal('useMe',()=>({me}))
    let finish:(value:unknown)=>void=()=>{}
    mocks.api.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    const mutation=useSaveHrLeaveSettings() as any
    const saving=mutation.mutationFn({cancellation_policy:'manager_only',revision:1})
    me.value={id:8,company:{id:4}}
    finish({cancellation_policy:'manager_only',revision:2})
    await saving
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
