import { describe,it,expect } from 'vitest'
import { packageInputSchema,packageActionSchema } from '../packages.js'
import { sharedOnboardingRequestSchema } from '../index.js'
const input={name:' Test ',description:' Useful package ',catalog_version:'v1',catalog_tier:'projects',limits:{'users.limit':0,'storage.limit_mb':null}}
describe('package contracts',()=>{
 it('trims metadata and preserves zero and unlimited',()=>{expect(packageInputSchema.parse(input)).toMatchObject({name:'Test',limits:input.limits})})
 it('rejects unknown input fields and non-safe integer limits',()=>{for(const value of [-1,0.5,true,Number.MAX_SAFE_INTEGER+1])expect(packageInputSchema.safeParse({...input,limits:{'users.limit':value}}).success).toBe(false);expect(packageInputSchema.safeParse({...input,modules:['evil']}).success).toBe(false)})
 it('requires optimistic revision and meaningful reason',()=>{expect(packageActionSchema.safeParse({revision:1,reason:'ok'}).success).toBe(false)})
 it('selects exactly one authority in onboarding',()=>{const base={request_id:'11111111-1111-4111-8111-111111111111',name:'Acme',admin_name:'Admin',admin_login:'admin@example.com',reason:'Enroll tenant'};expect(sharedOnboardingRequestSchema.safeParse({...base,package_revision_id:base.request_id}).success).toBe(true);expect(sharedOnboardingRequestSchema.safeParse({...base,package_revision_id:base.request_id,catalog_version:'v1',catalog_tier:'core'}).success).toBe(false);expect(sharedOnboardingRequestSchema.safeParse(base).success).toBe(false)})
})
