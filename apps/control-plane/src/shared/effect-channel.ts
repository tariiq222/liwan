import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import type { Config } from '../config.js'
import { signalGroup, terminateGroup } from '../process-group.js'

/**
 * The one way the control plane runs a tenant lifecycle effect. The worker never starts an effect module itself: it talks to
 * `tools/shared_saas_lifecycle/effect_gate.py` over one byte stream and the gate runs the effect.
 *
 * Wire protocol (identical on both transports, one JSON object per line):
 *   worker -> gate  line 1 `{"effect": <name>}`, line 2 the request (no `config`: the gate injects it), then any answers such as `{"proceed": true}`
 *   gate -> worker  the effect's own lines (`permit`, `result`, `error_code`), ending with `{"exit": <code>}` because a socket carries no exit status
 * The worker never half-closes before the `exit` line; ending the stream early is the signal to stop the effect.
 *
 * Transport: `LIWAN_EFFECT_SOCKET` set connects to that unix socket (systemd starts the gate as its own account there, and no worker
 * environment crosses); unset spawns the same gate as a child (local stack and tests).
 */
export const EFFECT_NAMES = ['odoo_effect', 'odoo_backup', 'subscription_effect', 'admin_password_effect', 'tenant_status_effect', 'tenant_drop_effect'] as const
export type EffectName = typeof EFFECT_NAMES[number]
export const EFFECT_GATE_MODULE = 'tools.shared_saas_lifecycle.effect_gate'
/** The effects need up to 15 s for their own `docker kill` on SIGTERM, and the gate gives 20 s: SIGKILL comes only after that. */
export const EFFECT_KILL_GRACE_MS = 25_000
/** The longest line either side accepts; the gate refuses a larger request. */
export const EFFECT_MAX_LINE = 65_536

export type Spawner = typeof spawn
/** Replaced only by tests. */
export type ChannelDeps = { spawnChild?: Spawner; connect?: (path: string) => Socket }

/** Exact names only, no prefixes: a spawned gate sees the settings it needs to find Python and Docker and none of the worker's secrets. */
const EFFECT_ENV_NAMES = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'LIWAN_SHARED_RUNTIME_CONFIG', 'LIWAN_RELEASE_ROUTES_DIR', 'LIWAN_RELEASE_HELPER_POOL_ID'] as const

export function effectEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of EFFECT_ENV_NAMES) { const value = env[name]; if (value !== undefined) out[name] = value }
  out.PYTHONUNBUFFERED = '1'
  return out
}

/** Starts a child in its own process group; `stop()` sends the group SIGTERM, then SIGKILL after `graceMs`, and a group left behind by a closed child is killed. */
export function spawnGrouped(spawnChild: Spawner | undefined, command: string, args: string[], options: SpawnOptions, graceMs = EFFECT_KILL_GRACE_MS): { child: ChildProcess; stop: () => void } {
  const child = (spawnChild ?? spawn)(command, args, { ...options, detached: true })
  // A child that never started has no pid and nothing to signal as a group.
  const send = (signal: NodeJS.Signals) => { if (child.pid === undefined) child.kill(signal); else signalGroup(child.pid, signal) }
  let cancelKill: (() => void) | undefined
  child.once('close', () => { cancelKill?.(); if (child.pid !== undefined) signalGroup(child.pid, 'SIGKILL') })
  return { child, stop: () => { cancelKill ??= terminateGroup(send, graceMs) } }
}

export type EffectChannel = {
  /** One JSON line to the gate; ignored once the channel is stopped or closed. */
  send: (message: unknown) => void
  /** Ends the effect: destroys the socket, or signals the gate's process group. Idempotent. */
  stop: () => void
}

/** The exit status the gate reports as its last line; any other line is the effect's. */
function exitStatus(line: string): number | undefined {
  if (!line.startsWith('{"exit"')) return undefined
  try {
    const message = JSON.parse(line)
    return message && typeof message === 'object' && Object.keys(message).length === 1 && Number.isInteger(message.exit) ? message.exit : undefined
  } catch { return undefined }
}

/**
 * Opens the effect's stream and writes the effect name and the request. `onLine` gets each of the effect's lines (never the `exit` line);
 * `onFault` fires once when the stream breaks or a line is too long (the channel is already stopping); `onClose` fires exactly once
 * with the gate's exit code, or null when the stream ended without one.
 */
export function openEffectChannel(input: {
  config: Pick<Config, 'python' | 'repositoryRoot' | 'effectSocket'>
  effect: EffectName
  request: unknown
  onLine: (line: string) => void
  onFault: () => void
  onClose: (exitCode: number | null) => void
  killGraceMs?: number
  deps?: ChannelDeps
}): EffectChannel {
  const { config, onLine, onFault, onClose } = input
  let buffer = '', exitCode: number | null = null, stopped = false, closed = false
  let write: (text: string) => void, halt: () => void
  const stop = () => { if (stopped || closed) return; stopped = true; halt() }
  const fault = () => { if (stopped || closed) return; stop(); onFault() }
  const close = () => { if (closed) return; closed = true; buffer = ''; onClose(exitCode) }
  const feed = (chunk: unknown) => {
    if (stopped || closed) return
    buffer += String(chunk)
    let newline: number
    while (!stopped && (newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
      if (line.length > EFFECT_MAX_LINE) return fault()
      const status = exitStatus(line)
      if (status !== undefined) exitCode = status
      else if (exitCode === null) onLine(line)
    }
    if (buffer.length > EFFECT_MAX_LINE) fault()
  }
  if (config.effectSocket) {
    const socket = (input.deps?.connect ?? connect)(config.effectSocket)
    socket.setEncoding('utf8')
    socket.on('data', feed); socket.on('error', fault); socket.on('close', close)
    write = text => { socket.write(text) }
    halt = () => { socket.destroy() }
  } else {
    const { child, stop: stopGroup } = spawnGrouped(input.deps?.spawnChild, config.python, ['-E', '-s', '-B', '-m', EFFECT_GATE_MODULE],
      { cwd: config.repositoryRoot, stdio: ['pipe', 'pipe', 'ignore'], env: effectEnv() }, input.killGraceMs)
    child.stdout?.setEncoding?.('utf8')
    child.on('error', fault); child.stdin?.on('error', fault)
    child.stdout?.on('data', feed); child.on('close', close)
    write = text => { child.stdin?.write(text) }
    halt = stopGroup
  }
  // The request goes in through the stream only; neither argv nor the environment carries it.
  write(JSON.stringify({ effect: input.effect }) + '\n' + JSON.stringify(input.request) + '\n')
  return { send: message => { if (!stopped && !closed) write(JSON.stringify(message) + '\n') }, stop }
}
