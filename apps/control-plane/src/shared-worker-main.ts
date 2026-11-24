import {dispatchRestorePublication} from './shared/restore-publication.js'
import { Pool } from 'pg'
import { getConfig } from './config.js'
import { attachPoolErrorHandler,migrate } from './db.js'
import { createOdooAdapter,reconcileOdooOnboardings } from './shared/odoo-adapter.js'
import { sharedOnboardingEnabled } from './shared/onboarding.js'
import { createCommercialScheduler } from './commercial/scheduler.js'
import { paymentAdapterFromEnv } from './commercial/payment-adapter.js'
import { mailAdapterFromEnv,SCHEDULED_MAIL_SEND_TIMEOUT_MS } from './commercial/mail-adapter.js'
import { createAdminPasswordRunner } from './shared/admin-password-runner.js'
import { loadSharedRuntimeConfig } from './shared/runtime-config.js'
import { startInternalEffectServer } from './shared/internal-effect-server.js'
import { runSharedWorker } from './shared/job-runner.js'
import { createMaintenanceRunner,type MaintenanceStep } from './shared/job-loop.js'
import { processJobRecoveries } from './shared/job-recovery.js'
import { processJobAbandonments } from './shared/job-abandon.js'
import { onShutdownSignal } from './shutdown.js'
import { createDeletionEffects } from './shared/tenant-deletion-effects-runner.js'
import { createTenantStorageRunner } from './shared/tenant-storage-runner.js'
import { runTenantStorageLoop } from './shared/tenant-storage.js'
import { logText } from './log-text.js'
import { startWorkerHeartbeat,recordAvailability,type AvailabilityComponent } from './service-health.js'
import { telegramSenderFromEnv } from './commercial/telegram-adapter.js'
const config=getConfig()
if(!await sharedOnboardingEnabled(config))throw Error('shared_adapter_unavailable')
const pool=new Pool({connectionString:config.databaseUrl,max:8})
attachPoolErrorHandler(pool)
const controller=new AbortController()
onShutdownSignal(()=>controller.abort())
let scheduler:ReturnType<typeof createCommercialScheduler>|undefined
let storageLoop:Promise<void>|undefined
try{
  await migrate(pool)
  const startedAt=new Date()
  // The worker's own beat runs on a timer, not in the job loop: a long backup or restore holds the loop, not the timer.
  startWorkerHeartbeat(pool,{startedAt,signal:controller.signal})
  const adapter=createOdooAdapter(pool,config,controller.signal)
  let paymentAdapter:ReturnType<typeof paymentAdapterFromEnv>|undefined
  let mailAdapter:ReturnType<typeof mailAdapterFromEnv>|undefined
  let telegramSender:ReturnType<typeof telegramSenderFromEnv>|undefined
  const adapterReports:Promise<void>[]=[]
  const reportAdapter=(component:AvailabilityComponent,error?:unknown)=>{adapterReports.push(recordAvailability(pool,component,{startedAt,error}))}
  try{paymentAdapter=paymentAdapterFromEnv(process.env);reportAdapter('payment_adapter')}catch(e){console.error('commercial payment adapter unavailable: %s',logText(e));reportAdapter('payment_adapter',e)}
  try{mailAdapter=mailAdapterFromEnv(process.env,SCHEDULED_MAIL_SEND_TIMEOUT_MS);reportAdapter('mail_adapter')}catch(e){console.error('commercial mail adapter unavailable: %s',logText(e));reportAdapter('mail_adapter',e)}
  // No channel configured is a choice, not a failure: nothing is reported for it.
  try{telegramSender=telegramSenderFromEnv(process.env);if(telegramSender)reportAdapter('alert_channel')}catch(e){console.error('telegram alert channel unavailable: %s',logText(e));reportAdapter('alert_channel',e)}
  await Promise.all(adapterReports)
  const effect=config.internalEffect
  // The password effect runs here because only the worker may reach Docker; control-api calls it over authenticated HTTPS.
  try{
    if(effect?.host && effect.port && effect.tls){
      const runner=createAdminPasswordRunner(pool,config)
      startInternalEffectServer({host:effect.host,port:effect.port,tls:effect.tls},{key:effect.key,inFlight:new Set<string>(),
        run:(input,requestSignal)=>runner(input,AbortSignal.any([requestSignal,controller.signal])),
        claimNonce:async(issuer,nonce)=>{
          await pool.query('DELETE FROM service_nonces WHERE expires_at < now()')
          const claimed=await pool.query("INSERT INTO service_nonces(issuer,nonce,expires_at) VALUES($1,$2,now()+interval '60 seconds') ON CONFLICT DO NOTHING RETURNING nonce",[issuer,nonce])
          return claimed.rowCount===1
        }},controller.signal)
    }
  }catch{console.error('internal_effect_unavailable','start_failed')}
  scheduler=createCommercialScheduler({pool,config,env:process.env,paymentAdapter,mailAdapter,telegramSender:telegramSender??undefined,subscriptionRunner:adapter.subscriptionRunner,usageRunner:adapter.observeUsage,tenantStatusRunner:adapter.setTenantStatus,tenantDeletionEffects:createDeletionEffects(config,loadSharedRuntimeConfig(config.sharedRuntimeConfigPath!),controller.signal),signal:controller.signal})
  const log=(message:string,error?:unknown)=>console.error('%s %s',logText(message),logText(error instanceof Error?error.stack??error.message:error,2000))
  const isStopping=()=>controller.signal.aborted
  // Per-tenant object storage (bucket, key, fs.storage): off unless the operator turns it on, and only for SaaS tenants.
  const storageRunner=config.tenantStorageEnabled?createTenantStorageRunner(pool,config):undefined
  const maintenance:MaintenanceStep[]=[
    {name:'job-recoveries',run:()=>processJobRecoveries(pool,adapter,{log})},
    {name:'job-abandonments',run:()=>processJobAbandonments(pool,adapter,{log})},
    {name:'onboarding-reconcile',run:()=>reconcileOdooOnboardings(pool,config,adapter,log)},
    {name:'commercial-scheduler',run:()=>scheduler!.tick()},
    {name:'restore-publication',run:()=>dispatchRestorePublication(pool,loadSharedRuntimeConfig(config.sharedRuntimeConfigPath!),adapter,{runner:adapter.observeRestoreSubscription})},
  ]
  // Its own loop, beside the job loop: a storage run can last minutes and must not hold back a backup, a restore or a reconfiguration.
  if(storageRunner)storageLoop=runTenantStorageLoop(pool,storageRunner,{signal:controller.signal,log})
  await runSharedWorker({pool,adapter,signal:controller.signal,afterDispatch:createMaintenanceRunner(maintenance,{isStopping,log,now:Date.now})})
}finally{controller.abort();await storageLoop?.catch(()=>{});await scheduler?.usageIdle().catch(()=>{});await pool.end()}
