import { spawnSync } from 'node:child_process'

// No third-party dependency or shell interpolation. Installed by install.py.
export const NasqUpdateGate = async ({ directory }) => ({
  'tool.execute.before': async (input, output) => {
    const result = spawnSync('python3', [
      '/Users/tariq/code/nasq/tools/update_gate/adapter.py', 'opencode',
    ], {
      input: JSON.stringify({ tool_name: input.tool, tool_input: output.args, cwd: directory }),
      encoding: 'utf8', timeout: 10000,
    })
    if (result.error || result.status !== 0) {
      throw new Error(result.stderr?.trim() || result.error?.message || 'Nasq update gate failed; action blocked.')
    }
  },
})
