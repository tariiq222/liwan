import { Pool } from 'pg'
import { getConfig } from './config.js'
import { attachPoolErrorHandler,migrate } from './db.js'
import { createOdooAdapter,reconcileOdooOnboardings } from './shared/odoo-adapter.js'
import { sharedOnboardingEnabled } from './shared/onboarding.js'
import { createCommercialScheduler } from './commercial/scheduler.js'
import { paymentAdapterFromEnv } from './commercial/payment-adapter.js'
import { mailAdapterFromEnv } from './commercial/mail-adapter.js'
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
  scheduler=createCommercialScheduler({pool,config,env:process.env,paymentAdapter,mailAdapter,subscriptionRunner:adapter.subscriptionRunner,usageRunner:adapter.observeUsage,signal:controller.signal})
  await runSharedWorker({pool,adapter,signal:controller.signal,afterDispatch:async()=>{await reconcileOdooOnboardings(pool,config,adapter);await scheduler!.tick()}})
}finally{await scheduler?.usageIdle().catch(()=>{});await pool.end()}
