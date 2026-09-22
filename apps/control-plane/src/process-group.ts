import { spawn } from 'node:child_process'

export type ProcessGroupResult = { code: number; stdout: string; timedOut: boolean; outputExceeded: boolean; groupTerminated: boolean; orphaned: boolean }
type Options = { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; graceMs: number; maxOutputBytes: number }

function groupAlive(id: number): boolean {
  try { process.kill(-id, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

function signalGroup(id: number, signal: NodeJS.Signals): void {
  try { process.kill(-id, signal) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
}

export async function runProcessGroup(command: string, args: string[], options: Options): Promise<ProcessGroupResult> {
  if (process.platform === 'win32') throw new Error('POSIX process groups are required')
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || !Number.isInteger(options.graceMs) || options.graceMs < 1 || !Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes < 1) throw new Error('invalid process limits')
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore','pipe','ignore'], shell: false })
  const group = child.pid
  let timedOut = false
  let outputExceeded = false
  let stopped = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const chunks: Buffer[] = []
  let bytes = 0
  const stop = () => {
    if (stopped || !group) return
    stopped = true
    signalGroup(group, 'SIGTERM')
    killTimer = setTimeout(() => signalGroup(group, 'SIGKILL'), options.graceMs)
  }
  child.stdout?.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > options.maxOutputBytes) { outputExceeded = true; stop() }
    else chunks.push(chunk)
  })
  const timer = setTimeout(() => { timedOut = true; stop() }, options.timeoutMs)
  const closed = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
    let failed: Error | undefined
    child.once('error', (error) => { failed = error })
    child.once('close', (code) => resolve({ code, error: failed }))
  })
  clearTimeout(timer)
  if (killTimer) clearTimeout(killTimer)
  const orphaned = Boolean(group && groupAlive(group) && !timedOut && !outputExceeded)
  if (group && groupAlive(group)) signalGroup(group, 'SIGKILL')
  let groupTerminated = !group || !groupAlive(group)
  for (let index = 0; !groupTerminated && index < 100; index++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    groupTerminated = !groupAlive(group!)
  }
  return { code: closed.error ? 5 : typeof closed.code === 'number' ? closed.code : 5,
    stdout: Buffer.concat(chunks).toString('utf8'), timedOut, outputExceeded, groupTerminated, orphaned }
}
