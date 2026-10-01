import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, parse, dirname } from 'node:path'
import { z } from 'zod'
const absolute = z.string().refine(isAbsolute)
const schema = z.strictObject({schemaVersion:z.literal(1),projectName:z.string().regex(/^nasq-(?:saas|shared)-[a-z0-9-]{3,48}$/),composeFile:absolute,envFile:absolute,stateDir:absolute,domainSuffix:z.string().max(200).regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/)})
export type SharedRuntimeConfig = z.infer<typeof schema>
export function parseSharedRuntimeConfig(value:unknown):SharedRuntimeConfig { return schema.parse(value) }
export function assertNoSymlink(path:string) {
  if(!isAbsolute(path))throw Error('shared_runtime_path_invalid')
  let current=path
  while(current!==parse(current).root){if(lstatSync(current).isSymbolicLink())throw Error('shared_runtime_path_invalid');current=dirname(current)}
  if(realpathSync(path)!==path)throw Error('shared_runtime_path_invalid')
}
export function loadSharedRuntimeConfig(path:string):SharedRuntimeConfig {
  assertNoSymlink(path)
  const config=parseSharedRuntimeConfig(JSON.parse(readFileSync(path,'utf8')))
  for(const entry of [config.composeFile,config.envFile,config.stateDir])assertNoSymlink(entry)
  if(!lstatSync(config.stateDir).isDirectory() || !lstatSync(config.composeFile).isFile() || !lstatSync(config.envFile).isFile())throw Error('shared_runtime_path_invalid')
  return config
}
