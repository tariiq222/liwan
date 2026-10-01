/** Private operator entry point; no credentials or artifact paths are returned. */
import {Pool} from 'pg'
import {getConfig} from '../../apps/control-plane/src/config.ts'
import {loadSharedRuntimeConfig} from '../../apps/control-plane/src/shared/runtime-config.ts'
import {createOdooAdapter} from '../../apps/control-plane/src/shared/odoo-adapter.ts'
import {publishOdooRestore} from '../../apps/control-plane/src/shared/odoo-backup.ts'
const args=process.argv.slice(2)
function argument(name){const i=args.indexOf(name);if(i<0 || !args[i+1])throw Error('operator_input_invalid');return args[i+1]}
let pool
try{
 if(args[0]!=='publish'||args.length!==5||process.env.NASQ_TENANCY_MODE!=='shared')throw Error('operator_input_invalid')
 const config=getConfig(),actorUid=Number(argument('--actor'))
 if(!config.sharedRuntimeConfigPath||!Number.isSafeInteger(actorUid)||actorUid<=0)throw Error('operator_input_invalid')
 const runtime=loadSharedRuntimeConfig(config.sharedRuntimeConfigPath)
 pool=new Pool({connectionString:config.databaseUrl,max:4})
 const adapter=createOdooAdapter(pool,config,new AbortController().signal)
 console.log(JSON.stringify(await publishOdooRestore(pool,runtime,{issuer:config.installationId,actorUid},argument('--approval'),job=>adapter.observe(job))))
}catch{console.error('shared_restore_publication_unverified');process.exitCode=1}
finally{await pool?.end()}
