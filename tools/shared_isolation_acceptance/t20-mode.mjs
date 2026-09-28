import { readFileSync } from 'node:fs'
// Execute existing six-case built probe against the new shared artifact and preserved dedicated artifact.
// Only artifact paths change; all startup/mutation/downstream assertions remain intact.
const root = new URL('../../', import.meta.url).pathname
let source = readFileSync(root + 'apps/web/tests/tenancy-mutation-check.mjs', 'utf8')
source = source.replace("const web = resolve(import.meta.dirname, '..')", `const web = ${JSON.stringify(root + 'apps/web')}`)
source = source.replace('const artifact = resolve(web, `.output-t16-${built}`)', `const artifact = built === 'shared' ? ${JSON.stringify(new URL('./t20-built-shared', import.meta.url).pathname)} : resolve(web, '.output-t16-dedicated')`)
source = source.replace("resolve(import.meta.dirname, 'tenancy-mutation-probe.mjs')", `resolve(web, 'tests/tenancy-mutation-probe.mjs')`)
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
