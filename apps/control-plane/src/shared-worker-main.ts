import {dispatchRestorePublication} from './shared/restore-publication.js'
import { Pool } from 'pg'
import { getConfig } from './config.js'
import { attachPoolErrorHandler,migrate } from './db.js'
import { createOdooAdapter,reconcileOdooOnboardings } from './shared/odoo-adapter.js'
import { sharedOnboardingEnabled } from './shared/onboarding.js'
import { createCommercialScheduler } from './commercial/scheduler.js'
import { paymentAdapterFromEnv } from './commercial/payment-adapter.js'
import { mailAdapterFromEnv } from './commercial/mail-adapter.js'
import { createAdminPasswordRunner } from './shared/admin-password-runner.js'
import { loadSharedRuntimeConfig } from './shared/runtime-config.js'
import { startInternalEffectServer } from './shared/internal-effect-server.js'
import { runSharedWorker } from './shared/job-runner.js'
const config=getConfig()
if(!await sharedOnboardingEnabled(config))throw Error('shared_adapter_unavailable')
const pool=new Pool({connectionString:config.databaseUrl,max:8})
attachPoolErrorHandler(pool)
const controller=new AbortController()
process.once('SIGTERM',()=>controller.abort())
process.once('SIGINT',()=>controller.abort())
let scheduler:ReturnType<typeof createCommercialScheduler>|undefined
try{
  await migrate(pool)
  const adapter=createOdooAdapter(pool,config,controller.signal)
  let paymentAdapter:ReturnType<typeof paymentAdapterFromEnv>|undefined
  let mailAdapter:ReturnType<typeof mailAdapterFromEnv>|undefined
  try{paymentAdapter=paymentAdapterFromEnv(process.env)}catch(e){console.error('commercial payment adapter unavailable:',e instanceof Error?e.message:e)}
  try{mailAdapter=mailAdapterFromEnv(process.env)}catch(e){console.error('commercial mail adapter unavailable:',e instanceof Error?e.message:e)}
  const effect=config.internalEffect
  // The password effect runs here because only the worker may reach Docker; control-api calls it over authenticated HTTPS.
  try{
    if(effect?.host && effect.port && effect.tls){
      const runner=createAdminPasswordRunner(pool,config,loadSharedRuntimeConfig(config.sharedRuntimeConfigPath!))
      startInternalEffectServer({host:effect.host,port:effect.port,tls:effect.tls},{key:effect.key,inFlight:new Set<string>(),
        run:(input,requestSignal)=>runner(input,AbortSignal.any([requestSignal,controller.signal])),
        claimNonce:async(issuer,nonce)=>{
          await pool.query('DELETE FROM service_nonces WHERE expires_at < now()')
          const claimed=await pool.query("INSERT INTO service_nonces(issuer,nonce,expires_at) VALUES($1,$2,now()+interval '60 seconds') ON CONFLICT DO NOTHING RETURNING nonce",[issuer,nonce])
          return claimed.rowCount===1
        }},controller.signal)
    }
  }catch{console.error('internal_effect_unavailable','start_failed')}
  scheduler=createCommercialScheduler({pool,config,env:process.env,paymentAdapter,mailAdapter,subscriptionRunner:adapter.subscriptionRunner,usageRunner:adapter.observeUsage,signal:controller.signal})
  await runSharedWorker({pool,adapter,signal:controller.signal,afterDispatch:async()=>{await reconcileOdooOnboardings(pool,config,adapter);await scheduler!.tick();await dispatchRestorePublication(pool,loadSharedRuntimeConfig(config.sharedRuntimeConfigPath!),adapter,{runner:adapter.observeRestoreSubscription})}})
}finally{await scheduler?.usageIdle().catch(()=>{});await pool.end()}
