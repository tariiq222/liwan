import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Pool } from 'pg'
import type { Claimed } from '../worker.js'
import { attachPoolErrorHandler, isTransientDatabaseError, transaction } from '../db.js'
import { runWorkerLoop } from '../worker-loop.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

function frame(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(5)
  header.write(type, 0, 'ascii')
  header.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([header, body])
}
function cstring(value: string): Buffer { return Buffer.from(`${value}\0`) }
function fakePostgres(onIdle: (socket: Socket) => void, shutdownCode?: string): Server {
  let dropNextQuery = shutdownCode === 'disconnect'
  return createServer((socket) => {
    let timer: NodeJS.Timeout | undefined
    socket.on('data', (data) => {
      if (data.length >= 8 && data.readInt32BE(4) === 196608) {
        socket.write(Buffer.concat([
          frame('R', Buffer.from([0, 0, 0, 0])),
          frame('S', Buffer.concat([cstring('server_version'), cstring('16.0')])),
          frame('S', Buffer.concat([cstring('client_encoding'), cstring('UTF8')])),
          frame('K', Buffer.from([0, 0, 0, 1, 0, 0, 0, 2])),
          frame('Z', Buffer.from('I')),
        ]))
        timer = setTimeout(() => onIdle(socket), 80)
      } else if (data[0] === 81) {
        if (dropNextQuery) {
          dropNextQuery = false
          if (shutdownCode && shutdownCode !== 'disconnect') {
            const fields = Buffer.concat([Buffer.from('C'), cstring('57P01'), Buffer.from('M'), cstring('terminating connection due to administrator command'), Buffer.from([0])])
            socket.write(Buffer.concat([frame('E', fields), frame('Z', Buffer.from('I'))]))
            socket.destroy()
          } else setTimeout(() => socket.destroy(), 20)
          return
        }
        socket.write(Buffer.concat([frame('C', cstring('SELECT 1')), frame('Z', Buffer.from('I'))]))
      }
    })
    socket.on('close', () => { if (timer) clearTimeout(timer) })
  })
}
async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing fake PostgreSQL port')
  return address.port
}

describe('database outage resilience', () => {
  it('survives a real pg-pool idle socket disconnect in a pinned Node child process', async () => {
    const wire = fakePostgres((socket) => socket.destroy())
    servers.push(wire)
    const port = await listen(wire)
    const child = spawn(process.execPath, ['--import', 'tsx', '-e', `
      const { Pool } = await import('pg');
      const { attachPoolErrorHandler, isTransientDatabaseError } = await import('./src/db.ts');
      const { runWorkerLoop } = await import('./src/worker-loop.ts');
      const pool = new Pool({ connectionString: 'postgres://fake:fake@127.0.0.1:${port}/fake', connectionTimeoutMillis: 500, idleTimeoutMillis: 1000 });
      attachPoolErrorHandler(pool);
      let idleError;
      pool.on('error', error => { idleError = error; });
      const client = await pool.connect();
      client.release();
      await new Promise(resolve => setTimeout(resolve, 120));
      if (!idleError || !isTransientDatabaseError(idleError)) process.exit(3);
      let waitCount = 0;
      let claimCount = 0;
      let executions = 0;
      let stopped = false;
      const claimed = { client: {} };
      await runWorkerLoop({
        isStopping: () => stopped,
        expire: async () => {},
        claim: async () => { claimCount++; if (claimCount === 1) throw idleError; return null; },
        execute: async () => { executions++; },
        isTransient: isTransientDatabaseError,
        wait: async ms => { if (ms !== 1000) process.exit(6); waitCount++; stopped = waitCount === 2; },
      });
      if (claimCount !== 2 || waitCount !== 2 || executions !== 0) process.exit(7);
      let executionCount = 0;
      let executionCaught;
      try {
        await runWorkerLoop({
          isStopping: () => false,
          expire: async () => {},
          claim: async () => claimed,
          execute: async () => { executionCount++; throw idleError; },
          isTransient: isTransientDatabaseError,
          wait: async () => { process.exit(8); },
        });
      } catch (error) { executionCaught = error; }
      if (executionCount !== 1 || executionCaught !== idleError) process.exit(9);
      process.stdout.write(JSON.stringify({idleError:{name:idleError.name,code:idleError.code ?? null,message:idleError.message,stack:(idleError.stack ?? '').split('\\n').slice(0,4)},sameObjectPollingRetry:true,claimCount,waitCount,noExecutionDuringOutage:executions===0,sameObjectExecutePropagated:executionCaught===idleError,executionCount})+'\\n');
      await pool.end();
      process.exit(0);
      setTimeout(() => process.exit(5), 2500).unref();
    `], { cwd: new URL('../../', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    const [code] = await once(child, 'exit') as [number | null]
    expect(code, Buffer.concat(output).toString()).toBe(0)
    expect(Buffer.concat(output).toString()).toContain('"message":"Connection terminated unexpectedly"')
    expect(Buffer.concat(output).toString()).toContain('/pg/lib/client.js:204:')
    expect(Buffer.concat(output).toString()).toContain('"sameObjectPollingRetry":true')
    expect(Buffer.concat(output).toString()).toContain('"noExecutionDuringOutage":true')
    expect(Buffer.concat(output).toString()).toContain('"sameObjectExecutePropagated":true')
    expect(Buffer.concat(output).toString()).toContain('"executionCount":1')
  })

  it('serves health HTTP 503 on pg disconnect then 200 after wire recovery', async () => {
    const wire = fakePostgres((socket) => socket.destroy(), 'disconnect')
    servers.push(wire)
    const port = await listen(wire)
    const pool = new Pool({ connectionString: `postgres://fake:fake@127.0.0.1:${port}/fake`, connectionTimeoutMillis: 500 })
    attachPoolErrorHandler(pool)
    const { createApp } = await import('../http.js')
    const config = { installationId: 'test', key: 'x'.repeat(32), inventoryPath: '', stateDir: '', repositoryRoot: '', python: 'python3' }
    const server = createApp(pool, config).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test HTTP port')
    const url = `http://127.0.0.1:${address.port}/healthz`
    const first = await fetch(url)
    expect(first.status).toBe(503)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const second = await fetch(url)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ status: 'ok' })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await pool.end()
  })

  it('retries pgwire shutdown responses with a bounded stop-aware wait only', async () => {
    const server = fakePostgres((socket) => socket.destroy(), 'shutdown')
    servers.push(server)
    const port = await listen(server)
    const pool = new Pool({ connectionString: `postgres://fake:fake@127.0.0.1:${port}/fake`, connectionTimeoutMillis: 500 })
    const waits: number[] = []
    let stopped = false
    const execute = async () => { const client = await pool.connect(); try { await client.query('SELECT 1') } finally { client.release() } }
    await runWorkerLoop({
      isStopping: () => stopped,
      expire: execute,
      claim: async () => null,
      execute: async () => { throw new Error('no claimed operation expected') },
      isTransient: isTransientDatabaseError,
      wait: async (ms) => { waits.push(ms); stopped = true },
    })
    expect(waits).toEqual([1000])
    await pool.end()
  })

  it('classifies known shutdown and socket errors, not similar programming errors', async () => {
    for (const code of ['57P01', '57P02', '57P03']) {
      expect(isTransientDatabaseError(Object.assign(new Error('database shutdown'), { code }))).toBe(true)
    }
    const { readFileSync } = await import('node:fs')
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const source = readFileSync(require.resolve('pg/lib/client'), 'utf8')
    expect(source).toContain("new Error('Connection terminated unexpectedly')")
    const driverError = new Error('Connection terminated unexpectedly')
    const malformed = Object.create(Error.prototype) as Error
    Object.assign(malformed, { message: driverError.message })
    const forgedStack = new Error(driverError.message)
    forgedStack.stack = `${forgedStack.name}: ${forgedStack.message}\\n    at unrelatedHandler (/app/worker.ts:10:2)`
    expect(isTransientDatabaseError(malformed)).toBe(false)
    expect(isTransientDatabaseError(forgedStack)).toBe(false)
    expect(driverError.stack).toContain('db-outage.test.ts')
    expect(isTransientDatabaseError(new Error('irrelevant'))).toBe(false)
    expect(isTransientDatabaseError(new Error('syntax error: Connection terminated unexpectedly in string literal'))).toBe(false)
    expect(isTransientDatabaseError(Object.assign(new Error('shutdown mention only'), { code: '42601' }))).toBe(false)
  })

  it('propagates programming errors without retrying the worker operation', async () => {
    const programmingError = Object.assign(new Error('bad query'), { code: '42601' })
    let polls = 0
    let waits = 0
    await expect(runWorkerLoop({
      isStopping: () => false,
      expire: async () => { polls++; throw programmingError },
      claim: async () => null,
      execute: async () => {},
      isTransient: (error) => (error as { code?: string }).code?.startsWith('08') ?? false,
      wait: async () => { waits++ },
    })).rejects.toBe(programmingError)
    expect(polls).toBe(1)
    expect(waits).toBe(0)
  })

  it('never replays executeClaimed after a finish write fails with uncertain shutdown outcome', async () => {
    for (const failure of [
      Object.assign(new Error('server shutdown'), { code: '57P01' }),
      new Error('Connection terminated unexpectedly'),
    ]) {
      const claimed = { client: {} } as Claimed
      let executions = 0
      await expect(runWorkerLoop({
        isStopping: () => false,
        expire: async () => {},
        claim: async () => claimed,
        execute: async () => { executions++; throw failure },
        isTransient: isTransientDatabaseError,
        wait: async () => {},
      })).rejects.toBe(failure)
      expect(executions).toBe(1)
    }
  })

  it('preserves the action error if rollback fails and always releases the client', async () => {
    const original = new Error('action failed')
    const client = {
      query: async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('rollback failed')
        if (sql === 'BEGIN') return
        throw original
      },
      release: () => { released++ },
    }
    let released = 0
    const pool = { connect: async () => client } as unknown as Pool
    await expect(transaction(pool, async () => { throw original })).rejects.toBe(original)
    expect(released).toBe(1)
  })
})
