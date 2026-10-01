import { Pool } from 'pg'
import { getConfig } from './config.js'
import { attachPoolErrorHandler,migrate } from './db.js'
import { createOdooAdapter,reconcileOdooOnboardings } from './shared/odoo-adapter.js'
import { sharedOnboardingEnabled } from './shared/onboarding.js'
import { runSharedWorker } from './shared/job-runner.js'
const config=getConfig()
if(!await sharedOnboardingEnabled(config))throw Error('shared_adapter_unavailable')
const pool=new Pool({connectionString:config.databaseUrl,max:8})
attachPoolErrorHandler(pool)
const controller=new AbortController()
process.once('SIGTERM',()=>controller.abort())
process.once('SIGINT',()=>controller.abort())
try{
  await migrate(pool)
  const adapter=createOdooAdapter(pool,config,controller.signal)
  await runSharedWorker({pool,adapter,signal:controller.signal,afterDispatch:()=>reconcileOdooOnboardings(pool,config,adapter)})
}finally{await pool.end()}
