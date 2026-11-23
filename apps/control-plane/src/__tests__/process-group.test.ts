import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcessGroup } from '../process-group.js'

it('terminates an operator and its child on timeout before returning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liwan-operator-group-'))
  try {
    const heartbeat = join(directory, 'heartbeat')
    const script = join(directory, 'parent.mjs')
    await writeFile(script, `import { spawn } from 'node:child_process';\nconst child = spawn(process.execPath, ['-e', ${JSON.stringify(`const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),15)`)}], { stdio:'ignore' });\nsetInterval(()=>{},1000);\n`)
    const result = await runProcessGroup(process.execPath, [script], { cwd: directory, env: process.env, timeoutMs: 1000, graceMs: 100, maxOutputBytes: 1024 })
    expect(result.timedOut).toBe(true)
    expect(result.groupTerminated).toBe(true)
    const before = await readFile(heartbeat, 'utf8')
    expect(before.length).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(await readFile(heartbeat, 'utf8')).toBe(before)
  } finally { await rm(directory, { recursive:true, force:true }) }
})

it('kills with SIGKILL a group that ignores SIGTERM after the grace period', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liwan-operator-kill-'))
  try {
    const heartbeat = join(directory, 'heartbeat')
    const script = join(directory, 'stubborn.mjs')
    await writeFile(script, `import fs from 'node:fs';\nprocess.on('SIGTERM',()=>{});\nsetInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),15);\n`)
    const result = await runProcessGroup(process.execPath, [script], { cwd: directory, env: process.env, timeoutMs: 300, graceMs: 200, maxOutputBytes: 1024 })
    expect(result.timedOut).toBe(true)
    expect(result.groupTerminated).toBe(true)
    const before = await readFile(heartbeat, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(await readFile(heartbeat, 'utf8')).toBe(before)
  } finally { await rm(directory, { recursive:true, force:true }) }
})
